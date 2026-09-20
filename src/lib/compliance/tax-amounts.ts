import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, complianceTaxAssessments, complianceTaxTypes, paymentAllocations, payments, tenants } from "@/db/schema";
import { getTdsReport, getVatReturn } from "./reports";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Named calculations a tax type can take its "amount due" from. The tax type's
// configuration picks one by name (compliance_tax_types.amount_source), so this
// file never mentions a country or a specific tax type.
const AMOUNT_SOURCES: Record<string, (tenantId: string, from: string, to: string) => Promise<number>> = {
  // Net VAT payable for the period (a net credit is not "due").
  vat_return: async (tenantId, from, to) => Math.max(0, (await getVatReturn(tenantId, from, to)).netVatPayable),
  // Tax withheld at source on the period's expenses.
  tds_withheld: async (tenantId, from, to) => (await getTdsReport(tenantId, from, to)).totalTds,
};

export type ObligationAmounts = {
  /** From the ledger/transactions of the period, when the tax type has a calculation; else null. */
  computedDue: number | null;
  /** Posted assessments, penalties and interest recorded against this obligation. */
  assessed: number;
  /** A figure entered by hand (only used when nothing is computed). */
  entered: number | null;
  due: number;
  /** Sum of the payments allocated to it (voided payments excluded). */
  paid: number;
  balance: number;
  lastPaymentDate: string | null;
};

type ObligationRef = Pick<typeof complianceObligations.$inferSelect, "id" | "taxTypeKey" | "periodStart" | "periodEnd" | "amountDue">;

/**
 * Amount due, paid and balance for tax obligations — LINKED to the books, not
 * typed in: due comes from the period's transactions (VAT return, TDS withheld)
 * plus assessments posted to the ledger, paid comes from the payments allocated
 * to the obligation. `excludePaymentId` is for voiding, when the payment being
 * voided has not yet been marked so.
 */
export async function obligationAmounts(tenantId: string, obligations: ObligationRef[], opts: { excludePaymentId?: string } = {}): Promise<Map<string, ObligationAmounts>> {
  const result = new Map<string, ObligationAmounts>();
  if (obligations.length === 0) return result;
  const ids = obligations.map((o) => o.id);

  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const taxTypes = await db.select().from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, tenant?.countryCode ?? ""));
  const sourceOf = new Map(taxTypes.map((t) => [t.key, t.amountSource]));

  const assessedRows = await db
    .select({ id: complianceTaxAssessments.obligationId, total: sql<string>`sum(${complianceTaxAssessments.amount})` })
    .from(complianceTaxAssessments)
    .where(and(eq(complianceTaxAssessments.tenantId, tenantId), eq(complianceTaxAssessments.status, "posted"), inArray(complianceTaxAssessments.obligationId, ids)))
    .groupBy(complianceTaxAssessments.obligationId);
  const assessed = new Map(assessedRows.map((r) => [r.id!, Number(r.total)]));

  const paidRows = await db
    .select({ id: paymentAllocations.targetId, total: sql<string>`sum(${paymentAllocations.allocatedAmount})`, last: sql<string>`max(${payments.paymentDate})` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(paymentAllocations.targetType, "tax_obligation"),
        inArray(paymentAllocations.targetId, ids),
        ne(payments.status, "voided"),
        ...(opts.excludePaymentId ? [ne(payments.id, opts.excludePaymentId)] : [])
      )
    )
    .groupBy(paymentAllocations.targetId);
  const paidBy = new Map(paidRows.map((r) => [r.id, { total: Number(r.total), last: r.last }]));

  for (const o of obligations) {
    const source = o.taxTypeKey ? sourceOf.get(o.taxTypeKey) : null;
    const compute = source ? AMOUNT_SOURCES[source] : undefined;
    const computedDue = compute && o.periodStart && o.periodEnd ? round2(await compute(tenantId, o.periodStart, o.periodEnd)) : null;
    const entered = o.amountDue !== null && o.amountDue !== undefined ? Number(o.amountDue) : null;
    const assessedTotal = round2(assessed.get(o.id) ?? 0);
    const due = round2((computedDue ?? entered ?? 0) + assessedTotal);
    const paid = round2(paidBy.get(o.id)?.total ?? 0);
    result.set(o.id, { computedDue, assessed: assessedTotal, entered, due, paid, balance: round2(due - paid), lastPaymentDate: paidBy.get(o.id)?.last ?? null });
  }
  return result;
}

/**
 * Keeps an obligation's status in step with what has actually been paid: fully
 * paid -> "paid", some -> "partially paid", and if the payments are voided it
 * falls back to filed/pending. Only touches the payment-driven statuses; it
 * never overrides not-applicable, and does not move an in-progress item unless
 * money has been paid against it.
 */
export async function syncObligationFromPayments(tenantId: string, obligationId: string, opts: { excludePaymentId?: string } = {}) {
  const [ob] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, obligationId), eq(complianceObligations.tenantId, tenantId)))
    .limit(1);
  if (!ob || ob.status === "not_applicable") return;

  const a = (await obligationAmounts(tenantId, [ob], opts)).get(ob.id)!;
  let status = ob.status;
  let paymentDate = ob.paymentDate;

  if (a.paid > 0.005) {
    status = a.balance <= 0.005 && a.due > 0 ? "paid" : "partially_paid";
    paymentDate = a.lastPaymentDate;
  } else if (ob.status === "paid" || ob.status === "partially_paid") {
    status = ob.filingDate ? "filed" : "pending";
    paymentDate = null;
  }

  if (status !== ob.status || paymentDate !== ob.paymentDate) {
    await db.update(complianceObligations).set({ status, paymentDate, updatedAt: new Date() }).where(eq(complianceObligations.id, ob.id));
  }
}
