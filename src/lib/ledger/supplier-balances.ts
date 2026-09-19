import { eq, ne, and } from "drizzle-orm";
import { db } from "@/db";
import { purchaseBills, payments, paymentAllocations } from "@/db/schema";

/**
 * Payments actually applied against this supplier's bills — the allocated
 * amount from the unified Payment module, not a payment's full amount (an
 * overpayment's unallocated remainder becomes a Supplier Advance instead of
 * reducing what's owed on any bill). Voided payments are excluded.
 */
export async function getSupplierPaymentRows(tenantId: string, vendorId?: string) {
  const conditions = [
    eq(payments.tenantId, tenantId),
    eq(paymentAllocations.targetType, "purchase_bill"),
    ne(payments.status, "voided"),
  ];
  if (vendorId) conditions.push(eq(purchaseBills.vendorId, vendorId));

  return db
    .select({ vendorId: purchaseBills.vendorId, date: payments.paymentDate, amount: paymentAllocations.allocatedAmount })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(purchaseBills, eq(purchaseBills.id, paymentAllocations.targetId))
    .where(and(...conditions));
}
