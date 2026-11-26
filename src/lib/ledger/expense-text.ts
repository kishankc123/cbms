import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, paymentAllocations, payments } from "@/db/schema";

// What an expense was for, to put beside its number on the reconciliation screens: an expense's own description (or its category when it has none), and for a
// payment that settles expenses, the descriptions of the ones it settles. Looked up in one pass for all the entries on a screen.

export type EntrySource = { entryId: string; sourceType: string; sourceId: string | null };

const MAX = 140;
const short = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

/** What each expense behind these entries was for, keyed by journal entry id. Entries that aren't about expenses are left out. */
export async function expenseTexts(tenantId: string, sources: readonly EntrySource[]): Promise<Map<string, string>> {
  const expenseEntries = sources.filter((s) => s.sourceType === "expense" && s.sourceId);
  const paymentEntries = sources.filter((s) => s.sourceType === "payment" || s.sourceType === "receipt");
  if (expenseEntries.length === 0 && paymentEntries.length === 0) return new Map();

  // A payment is found by the entry it posted (a newly recorded one has no source id on its entry), or by the source id an edited one carries.
  const found = paymentEntries.length
    ? await db
        .select({ id: payments.id, entryId: payments.journalEntryId })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, tenantId),
            or(inArray(payments.journalEntryId, paymentEntries.map((s) => s.entryId)), inArray(payments.id, paymentEntries.map((s) => s.sourceId).filter((id): id is string => Boolean(id)).concat("00000000-0000-0000-0000-000000000000")))
          )
        )
    : [];
  const paymentOf = new Map(paymentEntries.map((s) => [s.entryId, found.find((p) => p.entryId === s.entryId || p.id === s.sourceId)?.id]));
  const paymentIds = [...new Set(found.map((p) => p.id))];

  const settled = paymentIds.length
    ? await db.select({ paymentId: paymentAllocations.paymentId, expenseId: paymentAllocations.targetId }).from(paymentAllocations).where(and(eq(paymentAllocations.targetType, "expense"), inArray(paymentAllocations.paymentId, paymentIds)))
    : [];

  const wanted = [...new Set([...expenseEntries.map((s) => s.sourceId as string), ...settled.map((s) => s.expenseId)])];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: expenses.id, description: expenses.description, category: accounts.name })
    .from(expenses)
    .innerJoin(accounts, eq(accounts.id, expenses.categoryAccountId))
    .where(and(eq(expenses.tenantId, tenantId), inArray(expenses.id, wanted)));
  const textOf = new Map(rows.map((r) => [r.id, r.description?.trim() || r.category]));

  const out = new Map<string, string>();
  for (const s of expenseEntries) {
    const text = textOf.get(s.sourceId as string);
    if (text) out.set(s.entryId, short(text));
  }
  for (const [entryId, paymentId] of paymentOf) {
    const parts = [...new Set(settled.filter((x) => x.paymentId === paymentId).map((x) => textOf.get(x.expenseId)).filter((t): t is string => Boolean(t)))];
    if (parts.length > 0) out.set(entryId, short(parts.join("; ")));
  }
  return out;
}

/** A label with what the expense was for after it. A label that already says it is left as it is. */
export const withExpenseText = <T extends string | null>(label: T, text: string | undefined): T | string => {
  if (!text) return label;
  if (!label) return text;
  return label.includes(text) ? label : `${label} — ${text}`;
};
