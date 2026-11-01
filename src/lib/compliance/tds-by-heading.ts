import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceTaxHeads, employees, expenses, paymentAllocations, payments, payrollLines, payrollRuns, tenants, vendors } from "@/db/schema";
import { payrollTdsHeadKey } from "@/lib/ledger/tds-payable-accounts";

// TDS withheld in a period, by heading: the TDS on expenses (the heading of the expense's category) and the salary TDS of finalized payroll
// runs. TDS recorded before headings existed has no heading and is shown as "Not assigned". A TDS deposit is split by heading the same way.

const round2 = (n: number) => Math.round(n * 100) / 100;

export const NOT_ASSIGNED = "Not assigned";

export type WithheldLine = {
  /** An expense number, or the payroll month for salary. */
  reference: string;
  date: string;
  payee: string;
  taxable: number;
  tds: number;
  headKey: string | null;
  kind: "expense" | "payroll";
};

/** Heading names of this organization's country, by key. */
export async function tdsHeadNames(tenantId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: complianceTaxHeads.key, name: complianceTaxHeads.name })
    .from(complianceTaxHeads)
    .innerJoin(tenants, eq(tenants.countryCode, complianceTaxHeads.countryCode))
    .where(and(eq(tenants.id, tenantId), eq(complianceTaxHeads.taxTypeKey, "tds")))
    .orderBy(asc(complianceTaxHeads.sortOrder), asc(complianceTaxHeads.name));
  return new Map(rows.map((r) => [r.key, r.name]));
}

/** Every TDS withholding of the period (expenses by their date, payroll by the run's last day), newest data last. */
export async function tdsWithheldLines(tenantId: string, from: string, to: string): Promise<WithheldLine[]> {
  const expenseRows = await db
    .select({ number: expenses.expenseNumber, date: expenses.expenseDate, vendorId: expenses.vendorId, payeeName: expenses.payeeName, taxable: expenses.taxableAmount, tds: expenses.tdsAmount, headKey: expenses.tdsHeadKey })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to), ne(expenses.status, "void"), ne(expenses.tdsAmount, "0")))
    .orderBy(expenses.expenseDate);
  const vendorList = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const vendorName = new Map(vendorList.map((v) => [v.id, v.name]));

  const payrollHead = await payrollTdsHeadKey(tenantId);
  const payrollRows = await db
    .select({ month: payrollRuns.month, year: payrollRuns.year, calendar: payrollRuns.calendarSystem, date: payrollRuns.periodEnd, employee: employees.fullName, taxable: payrollLines.taxablePay, gross: payrollLines.grossPay, tds: payrollLines.tdsAmount })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .where(and(eq(payrollLines.tenantId, tenantId), eq(payrollRuns.status, "finalized"), gte(payrollRuns.periodEnd, from), lte(payrollRuns.periodEnd, to), ne(payrollLines.tdsAmount, "0")))
    .orderBy(payrollRuns.periodEnd, employees.fullName);

  return [
    ...expenseRows.map((r) => ({
      reference: r.number,
      date: r.date,
      payee: r.vendorId ? vendorName.get(r.vendorId) ?? r.payeeName ?? "—" : r.payeeName ?? "—",
      taxable: Number(r.taxable),
      tds: Number(r.tds),
      headKey: r.headKey,
      kind: "expense" as const,
    })),
    ...payrollRows.map((r) => ({
      reference: `Payroll ${r.calendar === "BS" ? "BS " : ""}${r.year}-${String(r.month).padStart(2, "0")}`,
      date: r.date,
      payee: r.employee,
      taxable: Number(r.taxable ?? r.gross),
      tds: Number(r.tds),
      headKey: payrollHead,
      kind: "payroll" as const,
    })),
  ];
}

export type HeadTotal = { key: string | null; name: string; taxable: number; withheld: number };

/** The lines added up by heading, with a name for each; headings come in the country's order, "Not assigned" last. */
export function totalsByHeading(lines: WithheldLine[], names: Map<string, string>): HeadTotal[] {
  const byKey = new Map<string | null, HeadTotal>();
  for (const l of lines) {
    const t = byKey.get(l.headKey) ?? { key: l.headKey, name: l.headKey ? names.get(l.headKey) ?? l.headKey : NOT_ASSIGNED, taxable: 0, withheld: 0 };
    t.taxable = round2(t.taxable + l.taxable);
    t.withheld = round2(t.withheld + l.tds);
    byKey.set(l.headKey, t);
  }
  const order = [...names.keys()];
  return [...byKey.values()].sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : order.indexOf(a.key) - order.indexOf(b.key)));
}

export async function tdsWithheldByHeading(tenantId: string, from: string, to: string) {
  const lines = await tdsWithheldLines(tenantId, from, to);
  const heads = totalsByHeading(lines, await tdsHeadNames(tenantId));
  return { lines, heads, total: round2(heads.reduce((s, h) => s + h.withheld, 0)) };
}

export type DepositRow = { key: string | null; name: string; withheld: number; deposited: number; remaining: number };

/** For a TDS deposit item: per heading, what was withheld in its period, what has been deposited against it, and what is still to deposit. */
export async function tdsDepositBreakdown(tenantId: string, obligation: { id: string; periodStart: string | null; periodEnd: string | null }): Promise<DepositRow[]> {
  if (!obligation.periodStart || !obligation.periodEnd) return [];
  const names = await tdsHeadNames(tenantId);
  const { heads } = await tdsWithheldByHeading(tenantId, obligation.periodStart, obligation.periodEnd);
  const paid = await db
    .select({ key: paymentAllocations.tdsHeadKey, total: sql<string>`sum(${paymentAllocations.allocatedAmount})` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(paymentAllocations.targetType, "tax_obligation"), eq(paymentAllocations.targetId, obligation.id), ne(payments.status, "voided")))
    .groupBy(paymentAllocations.tdsHeadKey);
  const depositedBy = new Map(paid.map((p) => [p.key, Number(p.total)]));

  const keys = new Set<string | null>([...heads.map((h) => h.key), ...depositedBy.keys()]);
  const withheldBy = new Map(heads.map((h) => [h.key, h.withheld]));
  return [...keys]
    .map((key) => {
      const withheld = withheldBy.get(key) ?? 0;
      const deposited = round2(depositedBy.get(key) ?? 0);
      return { key, name: key ? names.get(key) ?? key : NOT_ASSIGNED, withheld, deposited, remaining: Math.max(round2(withheld - deposited), 0) };
    })
    .sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : [...names.keys()].indexOf(a.key) - [...names.keys()].indexOf(b.key)));
}
