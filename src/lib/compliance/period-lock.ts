import { and, eq, lte, gte } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods } from "@/db/schema";

// The single guard every ledger posting passes through (see post.ts) — a
// closed period blocks new postings and reversals dated inside it, until an
// authorized user reopens it (see actions.ts's reopenPeriod).
export async function assertPeriodOpen(tenantId: string, date: string) {
  const [locked] = await db
    .select({ id: accountingPeriods.id, label: accountingPeriods.label })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.tenantId, tenantId),
        eq(accountingPeriods.status, "closed"),
        lte(accountingPeriods.periodStart, date),
        gte(accountingPeriods.periodEnd, date)
      )
    )
    .limit(1);
  if (locked) {
    throw new Error(`This date falls in the closed period "${locked.label}" — reopen it first to post here`);
  }
}
