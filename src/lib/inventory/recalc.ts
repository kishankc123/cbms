import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, items, journalEntries, journalLines, purchaseBills, purchaseReturns, salesInvoices, salesReturns, stockMovements } from "@/db/schema";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { todayIso } from "@/lib/calendar";
import { isDerived, replayCosts, type ReplayEvent } from "./cost";
import { loadActiveEvents, recostMovement } from "./stock";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type RecostChange = { movementId: string; sourceType: string | null; sourceId: string | null; date: string; type: string; quantity: number; from: number; to: number; delta: number };

export type ItemPlan = {
  itemId: string;
  name: string;
  /** Derived movements whose cost would change when history is replayed in date order. */
  changes: RecostChange[];
  before: { quantity: number; value: number };
  after: { quantity: number; value: number };
  lowestQuantity: number;
  lowestDate: string | null;
};

/**
 * Replays an item's history in date order and reports which costs would change — with an optional hypothetical change
 * (a document taken out, movements added), which is how a change is previewed before it is confirmed.
 */
export async function planItem(tenantId: string, itemId: string, override: { excludeSource?: { sourceType: string; sourceId?: string }; add?: ReplayEvent[] } = {}): Promise<ItemPlan> {
  const [item] = await db.select({ name: items.name, price: items.purchasePrice }).from(items).where(and(eq(items.id, itemId), eq(items.tenantId, tenantId))).limit(1);
  if (!item) throw new Error("Item not found");
  const price = Number(item.price);
  const events = await loadActiveEvents(tenantId, itemId);
  const current = replayCosts(events, price);
  const kept = events.filter((e) => !(override.excludeSource && e.sourceType === override.excludeSource.sourceType && (!override.excludeSource.sourceId || e.sourceId === override.excludeSource.sourceId)));
  const next = replayCosts([...kept, ...(override.add ?? [])], price);

  const changes: RecostChange[] = [];
  for (const e of kept) {
    if (!isDerived(e.type, e.quantity)) continue;
    const to = next.values.get(e.id);
    if (to === undefined || Math.abs(to - e.value) < 0.005) continue;
    changes.push({ movementId: e.movementId, sourceType: e.sourceType, sourceId: e.sourceId, date: e.date, type: e.type, quantity: e.quantity, from: e.value, to, delta: round2(to - e.value) });
  }
  return {
    itemId,
    name: item.name,
    changes,
    before: { quantity: current.finalQuantity, value: current.finalValue },
    after: { quantity: next.finalQuantity, value: next.finalValue },
    lowestQuantity: next.lowestQuantity,
    lowestDate: next.lowestDate,
  };
}

/** The document a movement came from, in words — for previews and history. */
export async function describeSources(tenantId: string, pairs: { sourceType: string | null; sourceId: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (t: string) => [...new Set(pairs.filter((p) => p.sourceType === t && p.sourceId).map((p) => p.sourceId as string))];
  const [inv, bills, srs, prs] = await Promise.all([
    ids("sale").length ? db.select({ id: salesInvoices.id, n: salesInvoices.invoiceNumber }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), inArray(salesInvoices.id, ids("sale")))) : [],
    ids("purchase").length ? db.select({ id: purchaseBills.id, n: purchaseBills.billNumber }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, tenantId), inArray(purchaseBills.id, ids("purchase")))) : [],
    ids("sales_return").length ? db.select({ id: salesReturns.id, n: salesReturns.noteNumber }).from(salesReturns).where(and(eq(salesReturns.tenantId, tenantId), inArray(salesReturns.id, ids("sales_return")))) : [],
    ids("purchase_return").length ? db.select({ id: purchaseReturns.id, n: purchaseReturns.noteNumber }).from(purchaseReturns).where(and(eq(purchaseReturns.tenantId, tenantId), inArray(purchaseReturns.id, ids("purchase_return")))) : [],
  ]);
  for (const d of inv) out.set(`sale:${d.id}`, `Sale ${d.n}`);
  for (const d of bills) out.set(`purchase:${d.id}`, `Purchase ${d.n}`);
  for (const d of srs) out.set(`sales_return:${d.id}`, `Sales return ${d.n}`);
  for (const d of prs) out.set(`purchase_return:${d.id}`, `Purchase return ${d.n}`);
  for (const p of pairs) if (p.sourceType === "adjustment" && p.sourceId) out.set(`adjustment:${p.sourceId}`, "Stock adjustment");
  return out;
}

// ------------------------------------------------------------------------------------------------ keeping the ledger in step

// The journal entry that books a movement's cost, by the kind of document it came from.
function costEntrySource(sourceType: string): { journalSource: "expense" | "sales_return" | "stock_adjustment" } | null {
  if (sourceType === "sale") return { journalSource: "expense" };
  if (sourceType === "sales_return") return { journalSource: "sales_return" };
  if (sourceType === "adjustment") return { journalSource: "stock_adjustment" };
  return null;
}

// What a document's movements are worth in total right now (re-costing included), across every item on it.
async function sourceValueTotal(tenantId: string, sourceType: string, sourceId: string) {
  const rows = await db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.sourceType, sourceType), eq(stockMovements.sourceId, sourceId)));
  const undone = new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId as string));
  let total = 0;
  for (const r of rows) {
    if (r.reversalOfId || undone.has(r.id)) continue; // (a re-costing is folded in as its own row: it adds to the total, base rows too)
    total += Number(r.value);
  }
  return round2(Math.abs(total));
}

/**
 * Makes the journal entry that books a document's cost say what its movements now say: the old entry is reversed and a new one
 * posted, both dated today (the period the correction is made in), so closed periods are never touched. Nothing happens when they
 * already agree, so it is safe to run again.
 */
async function syncCostEntry(tenantId: string, sourceType: string, sourceId: string, userId: string, reason: string) {
  const spec = costEntrySource(sourceType);
  if (!spec) return;
  const inventory = await findControlAccount(tenantId, ["1200"], "Inventory");
  if (!inventory) return;

  const entries = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, spec.journalSource), eq(journalEntries.sourceId, sourceId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
  const withInventory: { entry: (typeof entries)[number]; lines: (typeof journalLines.$inferSelect)[]; amount: number }[] = [];
  for (const entry of entries) {
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
    const line = lines.find((l) => l.accountId === inventory.id);
    if (line) withInventory.push({ entry, lines, amount: Math.abs(Number(line.debitAmount) - Number(line.creditAmount)) });
  }
  if (withInventory.length === 0) return;

  const target = await sourceValueTotal(tenantId, sourceType, sourceId);
  const posted = round2(withInventory.reduce((s, w) => s + w.amount, 0));
  if (Math.abs(target - posted) < 0.005) return;

  const template = withInventory[0];
  if (template.lines.length !== 2) return; // only the plain two-line cost entries are re-costed
  for (const w of withInventory) await reverseJournalEntry(tenantId, w.entry.id, userId, `Re-costed: ${reason}`);
  if (target <= 0) return;
  await postJournalEntry({
    tenantId,
    entryDate: todayIso(),
    sourceType: spec.journalSource,
    sourceId,
    referenceNumber: template.entry.referenceNumber ?? undefined,
    memo: `${template.entry.memo ?? "Stock cost"} (re-costed: ${reason})`,
    createdBy: userId,
    lines: template.lines.map((l) => ({ accountId: l.accountId, ...(Number(l.debitAmount) > 0 ? { debitAmount: target } : { creditAmount: target }), description: l.description ?? undefined })),
  });
}

export type RecalcResult = { items: number; changes: number };

/**
 * Puts the cost of every derived movement (sales, goods returned, write-offs) right for the history as it stands — replayed in
 * date order — and books the difference in the ledger. It is what keeps backdated documents, voids and edits to opening stock
 * honest. Idempotent: running it again finds nothing to do, and after an interruption it simply carries on.
 */
export async function recalculateItems(tenantId: string, itemIds: string[], opts: { userId: string; reason: string }): Promise<RecalcResult> {
  const plans: ItemPlan[] = [];
  for (const id of [...new Set(itemIds)]) plans.push(await planItem(tenantId, id));
  const changed = plans.filter((p) => p.changes.length > 0);
  if (changed.length === 0) return { items: 0, changes: 0 };
  await assertPeriodOpen(tenantId, todayIso());

  const sources = new Map<string, { sourceType: string; sourceId: string }>();
  for (const plan of changed) {
    for (const c of plan.changes) {
      await recostMovement(tenantId, { date: todayIso(), sourceType: c.sourceType ?? "recost", sourceId: (c.sourceId ?? c.movementId) as string, userId: opts.userId, note: opts.reason }, plan.itemId, c.movementId, c.delta);
      if (c.sourceType && c.sourceId) sources.set(`${c.sourceType}:${c.sourceId}`, { sourceType: c.sourceType, sourceId: c.sourceId });
    }
    await db.insert(auditLog).values({
      tenantId,
      userId: opts.userId,
      action: "inventory_recosted",
      entityType: "item",
      entityId: plan.itemId,
      beforeValue: { value: plan.before.value, quantity: plan.before.quantity },
      afterValue: { value: plan.after.value, quantity: plan.after.quantity, reason: opts.reason, movementsRecosted: plan.changes.length, costChange: round2(plan.changes.reduce((s, c) => s + c.delta, 0)) },
    });
  }
  for (const s of sources.values()) await syncCostEntry(tenantId, s.sourceType, s.sourceId, opts.userId, opts.reason);
  return { items: changed.length, changes: changed.reduce((s, p) => s + p.changes.length, 0) };
}

/**
 * The same, run after a document has already been saved: a problem here must not undo or hide the document, so it is recorded
 * instead of thrown, and \`recalculateAll\` (the "Recalculate" button) can be used to finish the job.
 */
export async function recalculateAfter(tenantId: string, itemIds: (string | null | undefined)[], userId: string, reason: string) {
  const ids = [...new Set(itemIds.filter((i): i is string => Boolean(i)))];
  if (ids.length === 0) return;
  try {
    await recalculateItems(tenantId, ids, { userId, reason });
  } catch (e) {
    await db.insert(auditLog).values({ tenantId, userId, action: "inventory_recost_pending", entityType: "item", entityId: ids[0], afterValue: { reason, problem: e instanceof Error ? e.message : String(e), items: ids } }).catch(() => {});
  }
}

export async function recalculateAll(tenantId: string, opts: { userId: string; reason: string }) {
  const all = await db.select({ id: items.id }).from(items).where(eq(items.tenantId, tenantId));
  return recalculateItems(tenantId, all.map((i) => i.id), opts);
}

// ------------------------------------------------------------------------------------------------------ checking the balances

/** Items whose stored quantity or value no longer equals what their movements add up to. */
export async function verifyStockBalances(tenantId: string) {
  const [rows, moves] = await Promise.all([
    db.select().from(items).where(eq(items.tenantId, tenantId)),
    db.select({ itemId: stockMovements.itemId, q: stockMovements.quantity, v: stockMovements.value }).from(stockMovements).where(eq(stockMovements.tenantId, tenantId)),
  ]);
  const sums = new Map<string, { q: number; v: number }>();
  for (const m of moves) {
    const s = sums.get(m.itemId) ?? { q: 0, v: 0 };
    s.q += Number(m.q);
    s.v += Number(m.v);
    sums.set(m.itemId, s);
  }
  return rows
    .map((i) => {
      const s = sums.get(i.id) ?? { q: 0, v: 0 };
      return { itemId: i.id, name: i.name, storedQuantity: Number(i.stockQuantity), storedValue: Number(i.stockValue), ledgerQuantity: round3(s.q), ledgerValue: round2(s.v) };
    })
    .filter((r) => Math.abs(r.storedQuantity - r.ledgerQuantity) > 0.0005 || Math.abs(r.storedValue - r.ledgerValue) > 0.005);
}

/** Sets each mismatched item's stored quantity and value back to what its movements add up to. */
export async function rebuildStockBalances(tenantId: string, userId: string) {
  const bad = await verifyStockBalances(tenantId);
  for (const r of bad) {
    await db.update(items).set({ stockQuantity: r.ledgerQuantity.toFixed(3), stockValue: r.ledgerValue.toFixed(2) }).where(and(eq(items.id, r.itemId), eq(items.tenantId, tenantId)));
    await db.insert(auditLog).values({ tenantId, userId, action: "inventory_balance_rebuilt", entityType: "item", entityId: r.itemId, beforeValue: { quantity: r.storedQuantity, value: r.storedValue }, afterValue: { quantity: r.ledgerQuantity, value: r.ledgerValue } });
  }
  return bad.length;
}
