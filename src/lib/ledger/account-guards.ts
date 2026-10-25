import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { paymentAllocations, payments, vendors } from "@/db/schema";
import { getCashBankAccounts } from "./cash-bank-accounts";
import { modeAccountIds } from "@/lib/payment-modes";
import { getCogsSubGroups } from "./control-accounts";
import { assertSourceNotReconciled } from "./reconciliation-guards";

/**
 * Every id must be an account money can move through in this organization: a Cash or Bank account, or an account linked to
 * an active payment mode (Fonepay and wallet accounts live there). What a payment can be received into / paid from.
 */
export async function assertCashBankAccounts(tenantId: string, accountIds: string[]) {
  if (accountIds.length === 0) return;
  const groups = await getCashBankAccounts(tenantId);
  const allowed = new Set(groups.flatMap((g) => [g.id, ...g.children.map((c) => c.id)]));
  for (const id of await modeAccountIds(tenantId)) allowed.add(id);
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
 * An expense that has payments recorded against it in the Payments module can't be edited or voided underneath them — the
 * payment would be left pointing at something that changed. Those payments have to be voided first (payments made when the
 * expense was created belong to it and are handled with it). Invoices and bills are different: what has been paid on them
 * follows the customer's or supplier's ledger (party-settlement.ts), so only a reconciled bank line holds them.
 */
export async function assertNoLaterPayments(tenantId: string, targetType: "purchase_bill" | "sales_invoice" | "expense", targetId: string, what: "bill" | "invoice" | "expense") {
  if (targetType === "expense") {
    const rows = await db
      .select({ n: payments.paymentNumber })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "standalone"), eq(payments.status, "posted"), eq(paymentAllocations.targetType, targetType), inArray(paymentAllocations.targetId, [targetId])));
    if (rows.length > 0) {
      throw new Error(`This ${what} has payment ${[...new Set(rows.map((r) => r.n))].join(", ")} recorded in Payments — void ${rows.length > 1 ? "those payments" : "that payment"} first`);
    }
  }
  // ...nor once one of its bank lines has been matched to a bank statement.
  await assertSourceNotReconciled(tenantId, targetId, what);
}
