import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceObligations, employees, journalEntries, journalLines, payments, payrollLines, payrollRuns } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getTdsReport, getTdsPayableBalance } from "./reports";
import { tdsDepositPosition } from "./tds-deposits";
import { tdsHeadNames } from "./tds-by-heading";
import { obligationAmounts } from "./tax-amounts";
import { tdsDepositBreakdown } from "./tds-by-heading";
import { voidPayment } from "@/lib/ledger/payments-engine";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createExpense } = await import("@/app/(app)/expenses/actions");
const { recordObligationPayment, getTaxObligationDetail } = await import("@/app/(app)/compliance/tax-actions");

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const byName = async (name: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.name, name))))[0];
async function net(accountId: string) {
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, accountId)));
  return Math.round(lines.reduce((s, l) => s + Number(l.c) - Number(l.d), 0) * 100) / 100; // credit balance
}
const expense = (categoryAccountId: string, taxable: number, tds: number, accountId: string) => ({
  expenseDate: "2026-01-10",
  categoryAccountId,
  vendorId: null as string | null,
  description: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  billType: "no_bill" as const,
  taxTreatment: "taxable" as const,
  taxableAmount: taxable,
  vatAmount: 0,
  tdsAmount: tds,
  otherTaxAmount: 0,
  payments: [{ accountId, amount: taxable - tds }],
});

// The headings carry whatever names the platform administrator gave them, so the tests read the names rather than assume them.
const N = { payroll: "", rent: "", services: "" };
let cashId: string;
let obligationId: string;
const OB = () => ({ id: obligationId, periodStart: "2026-01-01", periodEnd: "2026-01-31" });

beforeAll(async () => {
  org = await createTempOrg("ZZ TDS Deposit");
  cashId = (await acct("1000")).id;
  const names = await tdsHeadNames(org.tenantId);
  N.payroll = names.get("payroll")!;
  N.rent = names.get("rent")!;
  N.services = names.get("services")!;
  const [ob] = await db
    .insert(complianceObligations)
    .values({ tenantId: org.tenantId, name: "TDS Deposit", categoryKey: "tax", taxTypeKey: "tds", periodLabel: "Poush 2082", periodStart: "2026-01-01", periodEnd: "2026-01-31", dueDate: "2026-02-25" })
    .returning();
  obligationId = ob.id;
});
afterAll(async () => {
  await org.remove();
});

vi.setConfig({ testTimeout: 240_000 });

describe("TDS withheld and deposited by heading", () => {
  it("expense TDS posts to its heading's own payable account, and untagged TDS to the common one", async () => {
    await createExpense(expense((await acct("5100")).id, 80000, 8000, cashId)); // Rent
    await createExpense(expense((await acct("5700.03")).id, 25000, 3750, cashId)); // Consultancy fees, in Professional & Service Fees: Services
    await createExpense(expense((await acct("5300")).id, 5000, 500, cashId)); // Utilities: no heading
    expect(await net((await byName(`TDS Payable — ${N.rent}`)).id)).toBe(8000);
    expect(await net((await byName(`TDS Payable — ${N.services}`)).id)).toBe(3750);
    expect(await net((await acct("2320")).id)).toBe(500);
    expect(await getTdsPayableBalance(org.tenantId)).toBe(8000 + 3750 + 500); // all headings together
  });

  it("salary TDS of a finalized payroll run is withheld under the payroll heading", async () => {
    const [emp] = await db.insert(employees).values({ tenantId: org.tenantId, employeeCode: "T-1", fullName: "Sita Sharma", joiningDate: "2026-01-01" }).returning();
    const [run] = await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "AD", month: 1, year: 2026, periodStart: "2026-01-01", periodEnd: "2026-01-31", status: "finalized", createdBy: org.userId }).returning();
    await db.insert(payrollLines).values({ tenantId: org.tenantId, payrollRunId: run.id, employeeId: emp.id, basicSalary: "65000", workingDays: "26", presentDays: "26", absentDays: "0", proratedBasic: "65000", grossPay: "65000", taxablePay: "65000", tdsAmount: "2050", netPay: "62950" });
    const r = await getTdsReport(org.tenantId, "2026-01-01", "2026-01-31");
    expect(r.byHeading.map((h) => [h.name, h.withheld])).toEqual([[N.payroll, 2050], [N.rent, 8000], [N.services, 3750], ["Not assigned", 500]]);
    expect(r.totalTds).toBe(14300);
    expect(r.rows.find((x) => x.kind === "payroll")).toMatchObject({ payee: "Sita Sharma", heading: N.payroll, taxableAmount: "65000.00", tdsAmount: "2050.00" });
    expect(r.rows.find((x) => x.kind === "expense" && x.heading === N.rent)?.expenseNumber).toMatch(/^EXP-/);
  });

  it("the monthly deposit item is due for everything withheld, split by heading", async () => {
    expect(await tdsDepositBreakdown(org.tenantId, OB())).toEqual([
      { key: "payroll", name: N.payroll, withheld: 2050, deposited: 0, remaining: 2050 },
      { key: "rent", name: N.rent, withheld: 8000, deposited: 0, remaining: 8000 },
      { key: "services", name: N.services, withheld: 3750, deposited: 0, remaining: 3750 },
      { key: null, name: "Not assigned", withheld: 500, deposited: 0, remaining: 500 },
    ]);
    const [ob] = await db.select().from(complianceObligations).where(eq(complianceObligations.id, obligationId));
    expect((await obligationAmounts(org.tenantId, [ob])).get(obligationId)?.due).toBe(14300);
    expect((await getTaxObligationDetail(obligationId)).tdsBreakdown?.length).toBe(4);
  });

  it("a deposit by heading clears each heading's own account, and no heading can be over-deposited", async () => {
    const pay = (headAmounts: { key: string | null; amount: number }[]) =>
      recordObligationPayment({ obligationId, amount: 0, headAmounts, paymentDate: "2026-02-20", accountId: cashId, paymentMethod: "cash", referenceNumber: "V-1", confirmDuplicate: true });
    await expect(pay([{ key: "rent", amount: 9000 }])).rejects.toThrow(/Rent: only 8000.00 is left to deposit/);

    await pay([{ key: "rent", amount: 8000 }, { key: "services", amount: 1000 }, { key: "payroll", amount: 2050 }]);
    expect(await net((await byName(`TDS Payable — ${N.rent}`)).id)).toBe(0);
    expect(await net((await byName(`TDS Payable — ${N.services}`)).id)).toBe(3750 - 1000);
    expect(await net((await byName("TDS Payable — Salary")).id)).toBe(-2050); // payroll was inserted without its ledger entry in this test
    expect(await net((await acct("2320")).id)).toBe(500); // untouched: nothing was deposited for "Not assigned"
    const rows = await tdsDepositBreakdown(org.tenantId, OB());
    expect(rows.map((r) => [r.name, r.deposited, r.remaining])).toEqual([[N.payroll, 2050, 0], [N.rent, 8000, 0], [N.services, 1000, 2750], ["Not assigned", 0, 500]]);
    const [ob] = await db.select().from(complianceObligations).where(eq(complianceObligations.id, obligationId));
    expect(ob.status).toBe("partially_paid");
    await expect(pay([{ key: "services", amount: 2751 }])).rejects.toThrow(new RegExp(`${N.services}: only 2750.00 is left`));
  });

  it("untagged TDS is deposited to the common account, and the item is paid once everything is in", async () => {
    await recordObligationPayment({ obligationId, amount: 0, headAmounts: [{ key: "services", amount: 2750 }, { key: null, amount: 500 }], paymentDate: "2026-02-21", accountId: cashId, paymentMethod: "cash", referenceNumber: "V-2", confirmDuplicate: true });
    expect(await net((await acct("2320")).id)).toBe(0);
    expect(await net((await byName(`TDS Payable — ${N.services}`)).id)).toBe(0);
    const [ob] = await db.select().from(complianceObligations).where(eq(complianceObligations.id, obligationId));
    expect(ob.status).toBe("paid");
  });

  it("voiding a deposit puts its headings back to still-to-deposit", async () => {
    const [second] = await db.select().from(payments).where(and(eq(payments.tenantId, org.tenantId), eq(payments.referenceNumber, "V-2")));
    await voidPayment(org.tenantId, second.id, org.userId, "test");
    const rows = await tdsDepositBreakdown(org.tenantId, OB());
    expect(rows.find((r) => r.key === "services")).toMatchObject({ deposited: 1000, remaining: 2750 });
    expect(rows.find((r) => r.key === null)).toMatchObject({ deposited: 0, remaining: 500 });
    expect(await net((await byName(`TDS Payable — ${N.services}`)).id)).toBe(2750);
  });
});

describe("TDS deposited by period and heading", () => {
  it("shows each heading's deposits for the period they pay for, with a voided deposit left out", async () => {
    const p = await tdsDepositPosition(org.tenantId, "2026-01-01", "2026-01-31");
    expect(p.rows.map((r) => [r.period, r.heading, r.withheld, r.deposited, r.remaining, r.status])).toEqual([
      ["Poush 2082", N.payroll, 2050, 2050, 0, "deposited"],
      ["Poush 2082", N.rent, 8000, 8000, 0, "deposited"],
      ["Poush 2082", N.services, 3750, 1000, 2750, "part"],
      ["Poush 2082", "Not assigned", 500, 0, 500, "none"],
    ]);
    expect(p.byHeading.map((h) => [h.heading, h.status])).toEqual([[N.payroll, "deposited"], [N.rent, "deposited"], [N.services, "part"], ["Not assigned", "none"]]);
    expect(p.byHeading.reduce((s, h) => s + h.withheld, 0)).toBe(14300);
    expect(p.byHeading.reduce((s, h) => s + h.remaining, 0)).toBe(3250);
  });

  it("a deposit counts for its period even when it was paid later, so a range after the deposit date still sees it", async () => {
    // the deposits above were paid on 20 and 21 February for January
    const p = await tdsDepositPosition(org.tenantId, "2026-01-15", "2026-02-28");
    expect(p.rows.find((r) => r.heading === N.rent)).toMatchObject({ period: "Poush 2082", deposited: 8000, status: "deposited" });
  });

  it("lists TDS withheld in a month with no deposit item, as not deposited, so a gap cannot hide", async () => {
    await createExpense({ ...expense((await acct("5100")).id, 20000, 2000, cashId), expenseDate: "2026-03-05" });
    const p = await tdsDepositPosition(org.tenantId, "2026-01-01", "2026-03-31");
    const gap = p.rows.filter((r) => r.obligationId === null);
    expect(gap.map((r) => [r.period, r.heading, r.withheld, r.deposited, r.status])).toEqual([["2026-03 (no deposit item)", N.rent, 2000, 0, "no_item"]]);
    expect(p.byHeading.find((h) => h.heading === N.rent)).toMatchObject({ withheld: 10000, deposited: 8000, remaining: 2000 });
  });

  it("can be limited to the payroll heading, which is what the payroll report shows", async () => {
    const p = await tdsDepositPosition(org.tenantId, "2026-01-01", "2026-03-31", "payroll");
    expect(p.rows.map((r) => [r.heading, r.withheld, r.deposited])).toEqual([[N.payroll, 2050, 2050]]);
  });

  it("the TDS report carries the same position", async () => {
    const r = await getTdsReport(org.tenantId, "2026-01-01", "2026-01-31");
    expect(r.deposits.byHeading.map((h) => [h.heading, h.withheld, h.deposited])).toEqual([[N.payroll, 2050, 2050], [N.rent, 8000, 8000], [N.services, 3750, 1000], ["Not assigned", 500, 0]]);
  });
});
