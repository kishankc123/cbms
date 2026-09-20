import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";

export const VOUCHER_PREFIX = "JV-";

export const formatVoucher = (n: number) => `${VOUCHER_PREFIX}${String(n).padStart(4, "0")}`;

/** The number the next manual entry will get (for showing on the form; not reserved). */
export async function peekNextVoucher(tenantId: string): Promise<string> {
  const [t] = await db.select({ seq: tenants.journalVoucherSeq }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return formatVoucher((t?.seq ?? 0) + 1);
}

/**
 * Issues the next manual-entry voucher number. The counter is bumped in a single
 * atomic UPDATE, so two people posting at the same moment can never get the same number.
 */
export async function issueVoucher(tenantId: string): Promise<string> {
  const [row] = await db
    .update(tenants)
    .set({ journalVoucherSeq: sql`${tenants.journalVoucherSeq} + 1` })
    .where(eq(tenants.id, tenantId))
    .returning({ seq: tenants.journalVoucherSeq });
  if (!row) throw new Error("Organization not found");
  return formatVoucher(row.seq);
}
