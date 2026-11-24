import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { paymentAllocations, payments, purchaseBills } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { resettleParty } from "@/lib/ledger/party-settlement";
import { reverseJournalEntry } from "@/lib/ledger/post";
import { isSourceReconciled, linesFromNet, postReclass } from "@/lib/ledger/reclass";
import { assertSupplierOwned } from "@/lib/ledger/account-guards";
import { assertBillNumberFree } from "./bill-records";
import { invoiceRequirements } from "./invoice-requirements";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReconciledBillEdit = {
  billId: string;
  vendorId: string;
  billNumber: string;
  /** Left out: the bill keeps the due date it has. */
  dueDate?: string | null;
  billAvailable?: boolean | null;
  /** Why the supplier is being changed: required then, recorded with the change. */
  reason?: string;
};

/**
 * Editing a purchase bill (a stockable invoice or a consumable bill) that has been reconciled: its payment was matched to a bank statement or ticked in a cash
 * reconciliation. The date, items, VAT, totals and payments are what was reconciled and cannot change. The supplier, the bill number, the due date and whether
 * the paper bill is in hand can. Moving the supplier moves what is still owed from one supplier's account to the other's, as a small voucher with the reason.
 */
export async function changeReconciledPurchaseBill(tenantId: string, userId: string, input: ReconciledBillEdit): Promise<{ changed: boolean }> {
  const [existing] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.id, input.billId), eq(purchaseBills.tenantId, tenantId))).limit(1);
  if (!existing) throw new Error("Bill not found");
  if (existing.purchaseType === "asset") throw new Error("This is an asset purchase. Change it from the asset's page in Assets.");
  if (existing.status === "void") throw new Error("A void bill can't be edited");
  if (!(await isSourceReconciled(tenantId, existing.id))) throw new Error("This bill has not been reconciled, so it can be edited in full.");

  const total = Number(existing.total);
  const paid = Number(existing.amountPaid);
  const remaining = round2(Math.max(total - paid, 0));
  const vendorId = input.vendorId || null;
  const needs = invoiceRequirements({ billType: existing.billType, total, paid });
  const billNumber = input.billNumber.trim() || (needs.numberRequired ? "" : existing.billNumber);
  if (!billNumber) throw new Error(`Bill number is required: ${needs.reason}`);
  if (!vendorId && needs.supplierRequired) throw new Error(`Select a supplier: ${needs.reason}`);
  if (vendorId) await assertSupplierOwned(tenantId, vendorId);
  if (billNumber !== existing.billNumber || vendorId !== (existing.vendorId ?? null)) await assertBillNumberFree(tenantId, vendorId, billNumber, existing.id);
  const dueDate = input.dueDate === undefined ? (existing.dueDate ?? null) : input.dueDate || null;
  if (dueDate && dueDate < existing.billDate) throw new Error("The due date can't be before the bill date");

  const vendorChanged = vendorId !== (existing.vendorId ?? null);
  const availableChanged = input.billAvailable !== undefined && (input.billAvailable ?? null) !== (existing.billAvailable ?? null);
  const detailsChanged = billNumber !== existing.billNumber || dueDate !== (existing.dueDate ?? null) || availableChanged;
  if (!vendorChanged && !detailsChanged) return { changed: false };

  const reason = (input.reason ?? "").trim();
  if (vendorChanged && !reason) throw new Error("Say why this is being changed: a bill that has been reconciled can still move to another supplier, and the reason is recorded with it.");

  // What is still owed sits on the supplier's own account; the part that was paid never did, so it stays where it is.
  let voucherId: string | null = null;
  if (vendorChanged && remaining > 0 && existing.vendorId && vendorId) {
    const [apOld, apNew] = await Promise.all([getOrCreateSupplierPayableAccountId(tenantId, existing.vendorId), getOrCreateSupplierPayableAccountId(tenantId, vendorId)]);
    voucherId = await postReclass({
      tenantId,
      userId,
      sourceId: existing.id,
      referenceNumber: billNumber,
      memo: `Bill ${existing.billNumber} — changed after reconciliation: ${reason}`,
      anchorDate: existing.billDate,
      lines: linesFromNet(
        new Map([
          [apOld, remaining], // debit: the old supplier is owed less
          [apNew, -remaining], // credit: the new supplier is owed it
        ]),
        reason
      ),
    });
  }

  try {
    await db
      .update(purchaseBills)
      .set({ vendorId, billNumber, dueDate, ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}) })
      .where(and(eq(purchaseBills.id, existing.id), eq(purchaseBills.tenantId, tenantId)));
    if (vendorChanged) {
      // The payments taken with the bill follow it to the new supplier.
      const embedded = await db
        .select({ id: payments.id })
        .from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "embedded"), eq(paymentAllocations.targetType, "purchase_bill"), eq(paymentAllocations.targetId, existing.id)));
      if (embedded.length > 0) {
        await db.update(payments).set({ vendorId, partyType: vendorId ? "supplier" : "none" }).where(and(eq(payments.tenantId, tenantId), inArray(payments.id, embedded.map((p) => p.id))));
      }
    }
  } catch (e) {
    if (voucherId) await reverseJournalEntry(tenantId, voucherId, userId, `Change to bill ${existing.billNumber} could not be completed`).catch(() => {});
    throw e;
  }
  if (vendorChanged) {
    await resettleParty(tenantId, "supplier", existing.vendorId).catch(() => {});
    await resettleParty(tenantId, "supplier", vendorId).catch(() => {});
  }

  await logAuditEvent({
    tenantId,
    userId,
    action: "purchase_bill_changed_after_reconciliation",
    entityType: "purchase_bill",
    entityId: existing.id,
    before: { bill: existing.billNumber, supplier: existing.vendorId ?? "—", dueDate: existing.dueDate ?? "—" },
    after: { bill: billNumber, supplier: vendorId ?? "—", dueDate: dueDate ?? "—", ...(reason ? { reason } : {}) },
  });
  return { changed: true };
}
