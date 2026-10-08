import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { payments, paymentAllocations, purchaseBills } from "@/db/schema";
import { withPaymentNumber } from "@/lib/payment-number";
import { reverseAllActiveEntriesForSource } from "@/lib/ledger/post";
import { resolvePaymentMode } from "@/lib/payment-modes";

// Records every kind of supplier bill shares (Consumable, Stockable and Asset purchases): the embedded payment row, the
// per-supplier bill number rule, and the clean-up of a bill that failed to save. Kept out of the "use server" action
// files so these are plain helpers, not callable endpoints.

// Deletes the embedded (paid-at-creation) Payment-module row(s) recorded
// for this bill, cascading to their allocation rows — called before a void
// or edit re-posts fresh entries.
export async function deleteEmbeddedPaymentsForBill(tenantId: string, billId: string) {
  const rows = await db
    .select({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "embedded"), eq(paymentAllocations.targetType, "purchase_bill"), eq(paymentAllocations.targetId, billId)));

  const paymentIds = [...new Set(rows.map((r) => r.paymentId))];
  for (const id of paymentIds) {
    await db.delete(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)));
  }
}

// Records the embedded supplier-payment row (+ its allocation to this bill)
// in the unified Payment module for a payment captured at bill
// creation/edit time — the accounting entry itself is posted separately by
// the caller, unchanged; this is purely the Payment module's own record of
// that same fact so it shows up in the Payments list and reconciliation.
export async function insertEmbeddedSupplierPayment(
  tenantId: string,
  userId: string,
  vendorId: string | null,
  billId: string,
  paymentDate: string,
  amount: number,
  accountId: string,
  journalEntryId: string,
  referenceNumber: string,
  modeId?: string | null
) {
  const mode = await resolvePaymentMode(tenantId, modeId, accountId);
  const [row] = await withPaymentNumber(tenantId, "money_out", (paymentNumber) =>
    db
    .insert(payments)
    .values({
      tenantId,
      paymentNumber,
      direction: "money_out",
      paymentType: "supplier_payment",
      paymentDate,
      partyType: vendorId ? "supplier" : "none",
      vendorId,
      accountId,
      paymentMethod: mode.paymentMethod,
      paymentModeId: mode.paymentModeId,
      paymentModeName: mode.paymentModeName,
      referenceNumber,
      amount: amount.toFixed(2),
      description: `Payment for ${referenceNumber}`,
      status: "posted",
      origin: "embedded",
      journalEntryId,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    })
    .returning()
  );

  await db.insert(paymentAllocations).values({ paymentId: row.id, targetType: "purchase_bill", targetId: billId, allocatedAmount: amount.toFixed(2) });
}

// A supplier's bill number is unique per supplier (two suppliers can both have a bill "101"). Void bills
// don't count, so a bill voided because of a typo can be entered again.
export async function assertBillNumberFree(tenantId: string, vendorId: string | null, billNumber: string, excludeBillId?: string) {
  const rows = await db
    .select({ id: purchaseBills.id, vendorId: purchaseBills.vendorId })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.billNumber, billNumber), ne(purchaseBills.status, "void")));
  if (rows.some((r) => r.id !== excludeBillId && (r.vendorId ?? null) === (vendorId ?? null))) {
    throw new Error(`Bill number ${billNumber} is already recorded${vendorId ? " for this supplier" : ""}`);
  }
}

// A failed save must not leave half a bill behind: undo whatever posted and drop the row.
export async function discardBill(tenantId: string, billId: string, userId: string) {
  await reverseAllActiveEntriesForSource(tenantId, billId, userId, "Rolled back — bill could not be saved").catch(() => {});
  await deleteEmbeddedPaymentsForBill(tenantId, billId).catch(() => {});
  await db.delete(purchaseBills).where(eq(purchaseBills.id, billId));
}
