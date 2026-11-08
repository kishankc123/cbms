import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { daybookCashCounts } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { cashAccountRows } from "@/lib/dashboard/cash-flow";
import { loadDaybook } from "./daybook";
import { cleanNotes, countedTotal, type CountedNotes, type SavedCount } from "./cash-count-rules";

export * from "./cash-count-rules";

export async function loadCashCounts(tenantId: string, day: string): Promise<SavedCount[]> {
  const rows = await db.select().from(daybookCashCounts).where(and(eq(daybookCashCounts.tenantId, tenantId), eq(daybookCashCounts.countDate, day)));
  return rows.map((r) => ({ accountId: r.accountId, notes: r.notes as CountedNotes, other: Number(r.otherAmount), counted: Number(r.countedTotal), book: Number(r.bookBalance), remark: r.remark ?? "", updatedAt: r.updatedAt.toISOString() }));
}

export type SaveCountInput = { day: string; accountId: string; notes: Record<string, unknown>; other: number; remark: string };

/** Saves (or replaces) the count of one cash account for one day. The account must be one of the organization's cash accounts. The books are not changed. */
export async function saveCashCount(tenantId: string, userId: string, input: SaveCountInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const notes = cleanNotes(input.notes);
  if (!notes) return { ok: false, error: "A note count must be a whole number, zero or more." };
  if (!Number.isFinite(input.other) || input.other < 0 || input.other > 1e12) return { ok: false, error: "Coins and other cash must be zero or more." };

  const cash = (await cashAccountRows(tenantId)).filter((a) => a.code === "1000" || a.code.startsWith("1000."));
  const account = cash.find((a) => a.id === input.accountId);
  if (!account) return { ok: false, error: "That is not one of your cash accounts." };

  const book = (await loadDaybook(tenantId, input.day)).accounts.find((a) => a.accountId === account.id)?.closing ?? 0;
  const counted = countedTotal(notes, input.other);
  const values = { notes, otherAmount: input.other.toFixed(2), countedTotal: counted.toFixed(2), bookBalance: book.toFixed(2), remark: input.remark.trim().slice(0, 300) || null, countedBy: userId, updatedAt: new Date() };

  const [before] = await db.select().from(daybookCashCounts).where(and(eq(daybookCashCounts.tenantId, tenantId), eq(daybookCashCounts.countDate, input.day), eq(daybookCashCounts.accountId, account.id))).limit(1);
  const [saved] = await db
    .insert(daybookCashCounts)
    .values({ tenantId, countDate: input.day, accountId: account.id, ...values })
    .onConflictDoUpdate({ target: [daybookCashCounts.tenantId, daybookCashCounts.countDate, daybookCashCounts.accountId], set: values })
    .returning({ id: daybookCashCounts.id });
  await logAuditEvent({
    tenantId,
    userId,
    action: before ? "cash_count_changed" : "cash_count_saved",
    entityType: "cash_count",
    entityId: saved.id,
    before: before ? { counted: Number(before.countedTotal), book: Number(before.bookBalance) } : undefined,
    after: { day: input.day, account: account.name, counted, book },
  });
  return { ok: true };
}
