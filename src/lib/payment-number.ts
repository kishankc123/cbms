import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, tenants } from "@/db/schema";
import { buildInvoiceNumber } from "./invoice-number";

/**
 * Builds the next payment number per the tenant's configured numbering
 * (Settings > Payments) — a single "PAY-" sequence shared by both
 * directions, or a split "REC-"/"PAY-" sequence per direction. Never
 * hard-coded (spec section 31: "the numbering method should be
 * configurable rather than hard-coded").
 */
export async function buildNextPaymentNumber(tenantId: string, direction: "money_in" | "money_out"): Promise<string> {
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
  return buildInvoiceNumber(prefix, suffix, existingCount + 1, format);
}
