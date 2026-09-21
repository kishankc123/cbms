import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditApplications, paymentAllocations, payments, purchaseReturns, salesReturns, vendors } from "@/db/schema";
import { getCashBankAccounts } from "./cash-bank-accounts";
import { getCogsSubGroups } from "./control-accounts";

/** Every id must be a Cash or Bank account of this organization (what a payment can be received into / paid from). */
export async function assertCashBankAccounts(tenantId: string, accountIds: string[]) {
  if (accountIds.length === 0) return;
  const groups = await getCashBankAccounts(tenantId);
  const allowed = new Set(groups.flatMap((g) => [g.id, ...g.children.map((c) => c.id)]));
  if (accountIds.some((id) => !allowed.has(id))) throw new Error("Choose a Cash or Bank account of this organization for the payment");
}

/** The category of a consumable purchase must be one of this organization's Cost of Goods Sold sub-groups. */
export async function assertCogsCategory(tenantId: string, accountId: string) {
  const allowed = new Set((await getCogsSubGroups(tenantId)).map((c) => c.id));
  if (!allowed.has(accountId)) throw new Error("Choose a valid purchase category");
}

export async function assertSupplierOwned(tenantId: string, vendorId: string) {
  const [v] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  if (!v) throw new Error("Supplier not found");
}

/**
 * A bill or invoice that has payments recorded against it in the Payments module can't be edited or
 * voided underneath them — the payment would be left pointing at something that changed. Those payments
 * have to be voided first (payments made when the bill was created belong to the bill and are handled with it).
 */
export async function assertNoLaterPayments(tenantId: string, targetType: "purchase_bill" | "sales_invoice", targetId: string, what: "bill" | "invoice") {
  const rows = await db
    .select({ n: payments.paymentNumber })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.origin, "standalone"),
        eq(payments.status, "posted"),
        eq(paymentAllocations.targetType, targetType),
        inArray(paymentAllocations.targetId, [targetId])
      )
    );
  // ...nor under a return's credit that has been applied to it.
  const applied = await db
    .select({ returnId: creditApplications.returnId, kind: creditApplications.kind })
    .from(creditApplications)
    .where(and(eq(creditApplications.tenantId, tenantId), eq(creditApplications.targetId, targetId), eq(creditApplications.status, "applied")));
  if (applied.length > 0) {
    const ids = applied.map((a) => a.returnId);
    const notes = [
      ...(await db.select({ n: salesReturns.noteNumber }).from(salesReturns).where(inArray(salesReturns.id, ids))),
      ...(await db.select({ n: purchaseReturns.noteNumber }).from(purchaseReturns).where(inArray(purchaseReturns.id, ids))),
    ];
    throw new Error(`Credit from ${notes.map((r) => r.n).join(", ") || "a return"} has been applied to this ${what} — take that back first`);
  }
  if (rows.length > 0) {
    throw new Error(`This ${what} has payment ${[...new Set(rows.map((r) => r.n))].join(", ")} recorded in Payments — void ${rows.length > 1 ? "those payments" : "that payment"} first`);
  }
}
