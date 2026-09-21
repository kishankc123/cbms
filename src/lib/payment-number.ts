import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, tenants } from "@/db/schema";
import { buildInvoiceNumber } from "./invoice-number";
import { nextFreeInvoiceNumber } from "./sales/invoice-numbering";

/**
 * Builds the next payment number per the tenant's configured numbering
 * (Settings > Payments) — a single "PAY-" sequence shared by both
 * directions, or a split "REC-"/"PAY-" sequence per direction. Never
 * hard-coded (spec section 31: "the numbering method should be
 * configurable rather than hard-coded").
 */
export async function buildNextPaymentNumber(tenantId: string, direction: "money_in" | "money_out", skip = 0): Promise<string> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const mode = tenant?.paymentNumberMode ?? "single";
  const format = tenant?.paymentNumberFormat ?? "prefix-number-suffix";

  const isSplit = mode === "split";
  const prefix = isSplit ? (direction === "money_in" ? tenant?.receiptPrefix : tenant?.paymentPrefix) : tenant?.paymentPrefix;
  const suffix = isSplit ? (direction === "money_in" ? tenant?.receiptSuffix : tenant?.paymentSuffix) : tenant?.paymentSuffix;

  const where = isSplit
    ? and(eq(payments.tenantId, tenantId), eq(payments.direction, direction))
    : eq(payments.tenantId, tenantId);

  const [{ value: existingCount }] = await db.select({ value: count() }).from(payments).where(where);
  // Numbers are unique per organization, so skip any that are taken (payments that were deleted, or recorded under
  // the other direction's sequence, must not cause a repeat).
  const all = await db.select({ n: payments.paymentNumber }).from(payments).where(eq(payments.tenantId, tenantId));
  const taken = new Set(all.map((r) => r.n));
  return nextFreeInvoiceNumber(taken, (n) => buildInvoiceNumber(prefix, suffix, n, format), existingCount + 1 + skip).number;
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/**
 * Runs `run` with the next free payment number. If two payments are saved at the same instant the database's
 * unique rule refuses the second, which then simply takes the next number.
 */
export async function withPaymentNumber<T>(tenantId: string, direction: "money_in" | "money_out", run: (paymentNumber: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const paymentNumber = await buildNextPaymentNumber(tenantId, direction, attempt);
    try {
      return await run(paymentNumber);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      last = e;
    }
  }
  throw last;
}
