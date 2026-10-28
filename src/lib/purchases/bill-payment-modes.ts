import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts, paymentAllocations, payments } from "@/db/schema";

/**
 * How each bill was paid, for the bills list: the payment mode of every payment made against it, whether it was paid when the bill
 * was entered or later from the Payments module. A payment made before modes existed shows the account it came out of instead.
 */
export async function paymentModesByBill(tenantId: string, billIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (billIds.length === 0) return out;
  const rows = await db
    .select({ billId: paymentAllocations.targetId, mode: payments.paymentModeName, account: accounts.name })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(accounts, eq(accounts.id, payments.accountId))
    .where(and(eq(payments.tenantId, tenantId), ne(payments.status, "voided"), eq(paymentAllocations.targetType, "purchase_bill"), inArray(paymentAllocations.targetId, billIds)))
    .orderBy(asc(payments.paymentDate));
  for (const r of rows) {
    const list = (out[r.billId] ??= []);
    const label = r.mode ?? r.account;
    if (!list.includes(label)) list.push(label);
  }
  return out;
}
