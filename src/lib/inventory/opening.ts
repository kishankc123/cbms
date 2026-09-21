import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, inventorySettings, items, journalEntries, stockMovements, tenants, users } from "@/db/schema";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { findControlAccount, getOrCreateBroughtForwardAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { todayIso, formatDate } from "@/lib/calendar";
import { describeSources, planItem, recalculateItems, type RecostChange } from "./recalc";
import { getInventorySettings, getOpeningDate, loadActiveEvents, moveStock, unwindStock } from "./stock";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function displayDate(tenantId: string, iso: string) {
  const [t] = await db.select({ calendar: tenants.calendarSystem }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return formatDate(iso, t?.calendar === "BS" ? "BS" : "AD");
}

// ------------------------------------------------------------------------------------------------------------- reading

export type OpeningRow = { itemId: string; name: string; unitId: string | null; date: string; quantity: number; unitCost: number; value: number };

/** The opening balance of each item (there is at most one per item), as it stands now. */
export async function getOpeningRows(tenantId: string): Promise<OpeningRow[]> {
  const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.sourceType, "opening")));
  const undone = new Set(moves.filter((m) => m.reversalOfId).map((m) => m.reversalOfId as string));
  const active = moves.filter((m) => !m.reversalOfId && !undone.has(m.id) && m.type === "opening");
  if (active.length === 0) return [];
  const rows = await db.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, active.map((m) => m.itemId))));
  const byId = new Map(rows.map((i) => [i.id, i]));
  const merged = new Map<string, OpeningRow>();
  for (const m of active) {
    const item = byId.get(m.itemId);
    if (!item) continue;
    const prev = merged.get(m.itemId);
    const quantity = round3((prev?.quantity ?? 0) + Number(m.quantity));
    const value = round2((prev?.value ?? 0) + Number(m.value));
    merged.set(m.itemId, { itemId: m.itemId, name: item.name, unitId: item.unitId, date: prev && prev.date > m.movementDate ? prev.date : m.movementDate, quantity, unitCost: quantity > 0 ? round2(value / quantity) : 0, value });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type HistoryRow = { id: string; when: string; user: string; action: string; itemName: string | null; before: unknown; after: unknown; reason: string | null };

const HISTORY_ACTIONS = ["inventory_opening_created", "inventory_opening_edited", "inventory_opening_deleted", "inventory_opening_date_changed", "inventory_recosted", "inventory_recost_pending", "inventory_balance_rebuilt"];

/** Opening stock history and every change that reached back into inventory balances, newest first. */
export async function getInventoryHistory(tenantId: string, limit = 200): Promise<HistoryRow[]> {
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.timestamp, action: auditLog.action, entityId: auditLog.entityId, before: auditLog.beforeValue, after: auditLog.afterValue, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.tenantId, tenantId), inArray(auditLog.action, HISTORY_ACTIONS)))
    .orderBy(desc(auditLog.timestamp))
    .limit(limit);
  const itemIds = [...new Set(rows.map((r) => r.entityId).filter((v): v is string => Boolean(v) && /^[0-9a-f-]{36}$/.test(v as string)))];
  const names = itemIds.length ? new Map((await db.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)))).map((i) => [i.id, i.name])) : new Map<string, string>();
  return rows.map((r) => ({
    id: r.id,
    when: r.at.toISOString(),
    user: r.userName ?? "—",
    action: r.action,
    itemName: r.entityId ? names.get(r.entityId) ?? null : null,
    before: r.before,
    after: r.after,
    reason: (r.after as { reason?: string } | null)?.reason ?? null,
  }));
}

// ------------------------------------------------------------------------------------------------------ opening balances

// An item's opening balance is normally one movement with the item as its source, but balances entered before there was one per
// item can be several, each with a source of its own — so everything still in force for the item is found here.
async function openingSources(tenantId: string, itemId: string) {
  const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId), eq(stockMovements.sourceType, "opening")));
  const undone = new Set(moves.filter((m) => m.reversalOfId).map((m) => m.reversalOfId as string));
  return [...new Set(moves.filter((m) => !m.reversalOfId && !undone.has(m.id)).map((m) => m.sourceId as string))];
}

async function openingJournalEntries(tenantId: string, itemId: string) {
  const sources = [...new Set([itemId, ...(await openingSources(tenantId, itemId))])];
  return db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "stock_adjustment"), inArray(journalEntries.sourceId, sources), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId)));
}

async function postOpeningJournal(tenantId: string, userId: string, item: { id: string; name: string }, date: string, value: number) {
  if (value <= 0) return;
  const inventory = await findControlAccount(tenantId, ["1200"], "Inventory");
  if (!inventory) throw new Error("No Inventory account found — add one to the Chart of Accounts first");
  const broughtForward = await getOrCreateBroughtForwardAccount(tenantId);
  await postJournalEntry({
    tenantId,
    entryDate: date,
    sourceType: "stock_adjustment",
    sourceId: item.id,
    referenceNumber: item.name,
    memo: `Opening stock - ${item.name}`,
    createdBy: userId,
    lines: [
      { accountId: inventory.id, debitAmount: value, description: `Opening stock - ${item.name}` },
      { accountId: broughtForward.id, creditAmount: value, description: `Opening stock - ${item.name}` },
    ],
  });
}

// Takes an item's opening balance (the movement and its journal entry) off the books, keeping both as history.
async function removeOpening(tenantId: string, userId: string, itemId: string, reason: string) {
  const journal = await openingJournalEntries(tenantId, itemId);
  for (const sourceId of await openingSources(tenantId, itemId)) await unwindStock(tenantId, { date: todayIso(), sourceType: "opening", sourceId, userId, note: reason }, { allowNegative: true });
  for (const e of journal) await reverseJournalEntry(tenantId, e.id, userId, `Opening stock changed: ${reason}`);
}

async function assertOpeningDateSet(tenantId: string) {
  const date = await getOpeningDate(tenantId);
  if (!date) throw new Error("Set the Inventory Opening Date first — opening stock belongs to that date");
  return date;
}

export type OpeningPreview = {
  item: string;
  hasOpening: boolean;
  before: { quantity: number; unitCost: number; value: number } | null;
  after: { quantity: number; unitCost: number; value: number } | null;
  /** Stock on hand and its value once everything after it has been re-costed. */
  stock: { quantityBefore: number; quantityAfter: number; valueBefore: number; valueAfter: number };
  /** The documents whose cost changes because of it. */
  affected: { document: string; date: string; from: number; to: number; delta: number }[];
  costOfGoodsSoldChange: number;
  /** Set when the change would take stock below zero at some date (and negative stock is not allowed). */
  blocked: string | null;
};

/** What changing (or, with no quantity, deleting) an item's opening stock would do — nothing is changed. */
export async function previewOpeningChange(tenantId: string, input: { itemId: string; quantity: number | null; unitCost?: number }): Promise<OpeningPreview> {
  const date = await assertOpeningDateSet(tenantId);
  const [item] = await db.select().from(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, tenantId))).limit(1);
  if (!item) throw new Error("Item not found");
  const existing = (await getOpeningRows(tenantId)).find((r) => r.itemId === input.itemId) ?? null;
  const newValue = input.quantity ? round2(input.quantity * (input.unitCost ?? 0)) : 0;

  const plan = await planItem(tenantId, input.itemId, {
    excludeSource: { sourceType: "opening" },
    add: input.quantity ? [{ id: "hypothetical-opening", date, order: -1, type: "opening", quantity: input.quantity, value: newValue }] : [],
  });
  const labels = await describeSources(tenantId, plan.changes);
  const settings = await getInventorySettings(tenantId);
  const current = await planItem(tenantId, input.itemId);
  const worse = plan.lowestQuantity < Math.min(0, current.lowestQuantity) - 0.0005;
  const blocked = worse && !settings.allowNegativeStock ? `${item.name} would drop to ${plan.lowestQuantity} on ${await displayDate(tenantId, plan.lowestDate ?? date)} — later sales and returns need more stock than this opening balance provides. Correct or void those first, or allow negative stock in Setup.` : null;

  return {
    item: item.name,
    hasOpening: Boolean(existing),
    before: existing ? { quantity: existing.quantity, unitCost: existing.unitCost, value: existing.value } : null,
    after: input.quantity ? { quantity: input.quantity, unitCost: input.unitCost ?? 0, value: newValue } : null,
    stock: { quantityBefore: plan.before.quantity, quantityAfter: plan.after.quantity, valueBefore: plan.before.value, valueAfter: plan.after.value },
    affected: plan.changes.map((c: RecostChange) => ({ document: labels.get(`${c.sourceType}:${c.sourceId}`) ?? "Stock movement", date: c.date, from: Math.abs(c.from), to: Math.abs(c.to), delta: c.delta })),
    costOfGoodsSoldChange: round2(-plan.changes.filter((c) => c.type === "sale").reduce((s, c) => s + c.delta, 0)),
    blocked,
  };
}

/** Creates an item's opening balance, or edits it (the original is kept as history and everything after is re-costed). */
export async function saveOpening(tenantId: string, userId: string, input: { itemId: string; quantity: number; unitCost: number; reason?: string }) {
  const date = await assertOpeningDateSet(tenantId);
  const quantity = round3(input.quantity);
  if (!(quantity > 0)) throw new Error("The quantity must be greater than zero");
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) throw new Error("The cost per unit can't be negative");
  const [item] = await db.select().from(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, tenantId))).limit(1);
  if (!item) throw new Error("Item not found");
  const reason = input.reason?.trim() || "";
  const value = round2(quantity * input.unitCost);
  const existing = (await getOpeningRows(tenantId)).find((r) => r.itemId === input.itemId) ?? null;

  await assertPeriodOpen(tenantId, date);
  if (existing) await assertPeriodOpen(tenantId, todayIso());
  const preview = await previewOpeningChange(tenantId, { itemId: input.itemId, quantity, unitCost: input.unitCost });
  if (preview.blocked) throw new Error(preview.blocked);

  if (existing) await removeOpening(tenantId, userId, input.itemId, reason || "edited");
  await moveStock(tenantId, { type: "opening", date, sourceType: "opening", sourceId: input.itemId, userId, note: `Opening stock - ${item.name}` }, [{ itemId: input.itemId, quantity, value }]);
  await postOpeningJournal(tenantId, userId, item, date, value);
  await db.insert(auditLog).values({
    tenantId,
    userId,
    action: existing ? "inventory_opening_edited" : "inventory_opening_created",
    entityType: "item",
    entityId: input.itemId,
    beforeValue: existing ? { quantity: existing.quantity, unitCost: existing.unitCost, value: existing.value } : null,
    afterValue: { quantity, unitCost: input.unitCost, value, openingDate: date, reason: reason || null },
  });
  if (existing) await recalculateItems(tenantId, [input.itemId], { userId, reason: `Opening stock of ${item.name} edited` });
}

/** Deletes an item's opening balance (kept as history). Refused if later movements need it. */
export async function deleteOpening(tenantId: string, userId: string, input: { itemId: string; reason?: string }) {
  await assertOpeningDateSet(tenantId);
  const existing = (await getOpeningRows(tenantId)).find((r) => r.itemId === input.itemId);
  if (!existing) throw new Error("This item has no opening stock");
  await assertPeriodOpen(tenantId, todayIso());
  const preview = await previewOpeningChange(tenantId, { itemId: input.itemId, quantity: null });
  if (preview.blocked) throw new Error(preview.blocked);
  const reason = input.reason?.trim() || "";

  await removeOpening(tenantId, userId, input.itemId, reason || "deleted");
  await db.insert(auditLog).values({
    tenantId,
    userId,
    action: "inventory_opening_deleted",
    entityType: "item",
    entityId: input.itemId,
    beforeValue: { quantity: existing.quantity, unitCost: existing.unitCost, value: existing.value },
    afterValue: { deleted: true, reason: reason || null },
  });
  await recalculateItems(tenantId, [input.itemId], { userId, reason: `Opening stock of ${existing.name} deleted` });
}

// ------------------------------------------------------------------------------------------------- the opening date

export type OpeningDatePreview = {
  currentDate: string | null;
  newDate: string;
  /** Movements dated before the new date — they would fall outside the history, so the date can't be set until they are dealt with. */
  blockers: { date: string; document: string; item: string }[];
  blockerCount: number;
  openingRows: number;
  openingValue: number;
  /** Opening balances that would be moved to the new date (their journal entries re-dated with them). */
  rowsMoved: number;
  documentsAfter: number;
};

export async function previewOpeningDate(tenantId: string, newDate: string): Promise<OpeningDatePreview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || Number.isNaN(new Date(newDate + "T00:00:00Z").getTime())) throw new Error("Enter a valid date");
  const settings = await getInventorySettings(tenantId);
  const all = await db.select({ id: items.id, name: items.name }).from(items).where(eq(items.tenantId, tenantId));
  const blockers: { date: string; sourceType: string | null; sourceId: string | null; item: string }[] = [];
  let documentsAfter = 0;
  for (const item of all) {
    for (const e of await loadActiveEvents(tenantId, item.id)) {
      if (e.type === "opening") continue;
      if (e.date < newDate) blockers.push({ date: e.date, sourceType: e.sourceType, sourceId: e.sourceId, item: item.name });
      else documentsAfter++;
    }
  }
  const labels = await describeSources(tenantId, blockers);
  const rows = await getOpeningRows(tenantId);
  blockers.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    currentDate: settings.openingDate,
    newDate,
    blockers: blockers.slice(0, 25).map((b) => ({ date: b.date, document: labels.get(`${b.sourceType}:${b.sourceId}`) ?? "Stock movement", item: b.item })),
    blockerCount: blockers.length,
    openingRows: rows.length,
    openingValue: round2(rows.reduce((s, r) => s + r.value, 0)),
    rowsMoved: rows.filter((r) => r.date !== newDate).length,
    documentsAfter,
  };
}

/** Sets (or changes) the Inventory Opening Date. Opening balances move to the new date, with their journal entries. */
export async function setOpeningDate(tenantId: string, userId: string, input: { date: string; reason?: string; confirmed: boolean }) {
  const preview = await previewOpeningDate(tenantId, input.date);
  if (input.date > todayIso()) throw new Error("The Inventory Opening Date can't be in the future");
  if (preview.blockerCount > 0) throw new Error(`${preview.blockerCount} stock movement${preview.blockerCount === 1 ? " is" : "s are"} dated before ${await displayDate(tenantId, input.date)}, so they would fall outside the inventory history. Correct those first or choose an earlier date.`);
  if (!input.confirmed) throw new Error("Review the impact and confirm the change");
  if (preview.currentDate === input.date) return;
  const reason = input.reason?.trim() || "";

  const rows = (await getOpeningRows(tenantId)).filter((r) => r.date !== input.date);
  if (rows.length > 0) {
    await assertPeriodOpen(tenantId, input.date);
    await assertPeriodOpen(tenantId, todayIso());
  }
  await db.insert(inventorySettings).values({ tenantId, openingDate: input.date }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: { openingDate: input.date } });

  const moved: string[] = [];
  for (const row of rows) {
    const [item] = await db.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.id, row.itemId), eq(items.tenantId, tenantId))).limit(1);
    if (!item) continue;
    const hadJournal = (await openingJournalEntries(tenantId, row.itemId)).length > 0;
    await removeOpening(tenantId, userId, row.itemId, `Inventory Opening Date changed to ${input.date}`);
    await moveStock(tenantId, { type: "opening", date: input.date, sourceType: "opening", sourceId: row.itemId, userId, note: `Opening stock - ${item.name}` }, [{ itemId: row.itemId, quantity: row.quantity, value: row.value }]);
    if (hadJournal) await postOpeningJournal(tenantId, userId, item, input.date, row.value);
    moved.push(row.itemId);
  }
  await db.insert(auditLog).values({
    tenantId,
    userId,
    action: "inventory_opening_date_changed",
    entityType: "inventory_settings",
    entityId: tenantId,
    beforeValue: { openingDate: preview.currentDate },
    afterValue: { openingDate: input.date, openingBalancesMoved: moved.length, openingValue: preview.openingValue, reason: reason || null },
  });
  if (moved.length > 0) await recalculateItems(tenantId, moved, { userId, reason: "Inventory Opening Date changed" });
}


