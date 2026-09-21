import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventorySettings, items, stockMovements, tenants } from "@/db/schema";
import { allocateProportional } from "./allocate";
import { EPS, issueCost, replayCosts, unitCostOf, type MovementType, type ReplayEvent } from "./cost";
import { formatDate } from "@/lib/calendar";

export { allocateProportional };
export type { MovementType };

export type StockCtx = {
  type: MovementType;
  date: string;
  /** The document this movement belongs to (an invoice, a bill, a return...), so it can be undone as a whole. */
  sourceType: string;
  sourceId: string;
  userId?: string | null;
  note?: string | null;
};

/**
 * One line of a movement. `quantity` is signed: + puts stock in, - takes it out. `value` is signed too and is what the
 * stock is worth on the books; leave it out and the movement is valued at the item's current cost per unit (a sale, or goods
 * coming back on a sales return). A purchase, a purchase return, an opening balance or an adjustment supplies its own value.
 */
export type StockLine = { itemId?: string | null; quantity: number; value?: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------------------------------------------- settings

export async function getInventorySettings(tenantId: string) {
  const [s] = await db.select().from(inventorySettings).where(eq(inventorySettings.tenantId, tenantId)).limit(1);
  return { allowNegativeStock: s?.allowNegativeStock ?? false, openingDate: s?.openingDate ?? null };
}

export async function getAllowNegativeStock(tenantId: string): Promise<boolean> {
  return (await getInventorySettings(tenantId)).allowNegativeStock;
}

/** When inventory history begins (null until it has been set). */
export async function getOpeningDate(tenantId: string): Promise<string | null> {
  return (await getInventorySettings(tenantId)).openingDate;
}

export class InventoryDateError extends Error {}

/**
 * Nothing that moves stock may be dated before the Inventory Opening Date — it would fall outside the inventory history. Until an
 * opening date has been set there is no limit. Documents without any item lines don't touch stock, so they are not held to it.
 */
export async function assertInventoryDate(tenantId: string, date: string, lines: { itemId?: string | null }[] = [{ itemId: "x" }]) {
  if (!lines.some((l) => l.itemId)) return;
  const opening = await getOpeningDate(tenantId);
  if (!opening || date >= opening) return;
  const [t] = await db.select({ calendar: tenants.calendarSystem }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const cal = t?.calendar === "BS" ? "BS" : "AD";
  throw new InventoryDateError(`${formatDate(date, cal)} is before the Inventory Opening Date of ${formatDate(opening, cal)}. Review the transaction date or update the Inventory Opening Date.`);
}

// ------------------------------------------------------------------------------------------------------------------ moving

type ItemRow = typeof items.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockItem(tx: Tx, tenantId: string, itemId: string): Promise<ItemRow> {
  const [item] = await tx.select().from(items).where(and(eq(items.id, itemId), eq(items.tenantId, tenantId))).for("update").limit(1);
  if (!item) throw new Error("An item on this document was not found");
  return item;
}

async function applyMovement(tx: Tx, tenantId: string, ctx: StockCtx, itemId: string, quantity: number, value: number, links: { reversalOfId?: string; recostOfId?: string } = {}) {
  await tx
    .update(items)
    .set({ stockQuantity: sql`${items.stockQuantity} + ${quantity}`, stockValue: sql`${items.stockValue} + ${value}` })
    .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
  await tx.insert(stockMovements).values({
    tenantId,
    itemId,
    movementDate: ctx.date,
    type: ctx.type,
    quantity: quantity.toFixed(3),
    value: value.toFixed(2),
    sourceType: ctx.sourceType,
    sourceId: ctx.sourceId,
    reversalOfId: links.reversalOfId ?? null,
    recostOfId: links.recostOfId ?? null,
    note: ctx.note ?? null,
    createdBy: ctx.userId ?? null,
  });
}

/**
 * Records the movement of stock for a document and keeps each item's quantity and cost in step. Lines without an item are
 * skipped. Taking out more than is on hand is refused unless the organization allows negative stock, and nothing dated before the
 * Inventory Opening Date is accepted. Returns the total value moved (signed: negative when stock went out) — for a sale, that is
 * the cost of goods sold. Costs here follow the stock as it is now; \`recalculateItems\` puts them right if the document is backdated.
 */
export async function moveStock(tenantId: string, ctx: StockCtx, lines: StockLine[], opts: { allowNegative?: boolean } = {}): Promise<{ value: number }> {
  const real = lines.filter((l) => l.itemId && round3(l.quantity) !== 0);
  if (real.length === 0) return { value: 0 };
  if (ctx.type !== "opening" && ctx.type !== "recost") await assertInventoryDate(tenantId, ctx.date);
  const allowNegative = opts.allowNegative ?? (await getAllowNegativeStock(tenantId));

  return db.transaction(async (tx) => {
    let total = 0;
    for (const line of real) {
      const q = round3(line.quantity);
      const item = await lockItem(tx, tenantId, line.itemId!);
      const state = { quantity: Number(item.stockQuantity), value: Number(item.stockValue) };
      const standard = Number(item.purchasePrice);
      let value: number;

      if (q > 0) {
        value = line.value !== undefined ? round2(line.value) : round2(q * unitCostOf(state, standard));
      } else {
        const out = -q;
        if (out > Math.max(state.quantity, 0) + EPS && !allowNegative) {
          throw new Error(`Only ${state.quantity} of ${item.name} in stock — can't take out ${out}`);
        }
        value = line.value !== undefined ? -round2(Math.abs(line.value)) : -issueCost(state, out, standard);
      }
      await applyMovement(tx, tenantId, ctx, item.id, q, value);
      total = round2(total + value);
    }
    return { value: total };
  });
}

/** Adds a re-costing movement (no quantity, only a value) to correct an earlier movement's cost. Used by the recalculation. */
export async function recostMovement(tenantId: string, ctx: Omit<StockCtx, "type">, itemId: string, targetMovementId: string, delta: number) {
  await db.transaction(async (tx) => {
    await lockItem(tx, tenantId, itemId);
    await applyMovement(tx, tenantId, { ...ctx, type: "recost" }, itemId, 0, round2(delta), { recostOfId: targetMovementId });
  });
}

// ---------------------------------------------------------------------------------------------------------------- history

export type ActiveEvent = ReplayEvent & { sourceType: string | null; sourceId: string | null; movementId: string };

/**
 * An item's movements that are still in force, ready to replay: an undone movement and its undoing cancel out and are left out, and
 * any re-costing of a movement is folded into its value.
 */
export async function loadActiveEvents(tenantId: string, itemId: string): Promise<ActiveEvent[]> {
  const rows = await db.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId)));
  const undone = new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId as string));
  const recosted = new Map<string, number>();
  for (const r of rows) {
    if (r.recostOfId && !r.reversalOfId && !undone.has(r.id)) recosted.set(r.recostOfId, (recosted.get(r.recostOfId) ?? 0) + Number(r.value));
  }
  return rows
    .filter((r) => !r.reversalOfId && !r.recostOfId && !undone.has(r.id))
    .map((r) => ({ id: r.id, movementId: r.id, date: r.movementDate, order: r.createdAt.getTime(), type: r.type, quantity: Number(r.quantity), value: round2(Number(r.value) + (recosted.get(r.id) ?? 0)), sourceType: r.sourceType, sourceId: r.sourceId }));
}

// Refused only when the change makes the lowest point WORSE than it already is — history that was already negative (from when
// negative stock was allowed) doesn't stop unrelated documents.
function tooLow(name: string, lowest: number, date: string | null, requested: number) {
  if (requested > 0) return new Error(`Only ${round3(requested + lowest)} of ${name} in stock on ${date ?? "that date"} — can't take out ${requested}`);
  return new Error(`${name} would drop to ${round3(lowest)} on ${date ?? "an earlier date"} — the stock on hand on that date can't cover this. Check the transaction date and the quantity.`);
}

/**
 * Checks, in date order, that a change never takes an item's stock below zero at any point: \`add\` are movements about to be recorded
 * (signed quantities, dated) and \`excludeSource\` is a document about to be undone or replaced. Skipped when the organization allows
 * negative stock.
 */
export async function assertStockTimeline(tenantId: string, opts: { add?: { itemId?: string | null; date: string; quantity: number }[]; excludeSource?: { sourceType: string; sourceId?: string } }) {
  if (await getAllowNegativeStock(tenantId)) return;
  const add = (opts.add ?? []).filter((a) => a.itemId && a.quantity !== 0);
  const ids = new Set(add.map((a) => a.itemId as string));
  if (opts.excludeSource) {
    const rows = await db.select({ itemId: stockMovements.itemId }).from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.sourceType, opts.excludeSource.sourceType), ...(opts.excludeSource.sourceId ? [eq(stockMovements.sourceId, opts.excludeSource.sourceId)] : [])));
    for (const r of rows) ids.add(r.itemId);
  }
  for (const itemId of ids) {
    const [item] = await db.select({ name: items.name, price: items.purchasePrice }).from(items).where(and(eq(items.id, itemId), eq(items.tenantId, tenantId))).limit(1);
    if (!item) throw new Error("An item on this document was not found");
    const events = await loadActiveEvents(tenantId, itemId);
    const price = Number(item.price);
    const current = replayCosts(events, price);
    const kept = events.filter((e) => !(opts.excludeSource && e.sourceType === opts.excludeSource.sourceType && (!opts.excludeSource.sourceId || e.sourceId === opts.excludeSource.sourceId)));
    const hypothetical: ReplayEvent[] = [
      ...kept,
      ...add.filter((a) => a.itemId === itemId).map((a, i) => ({ id: `hypothetical-${i}`, date: a.date, order: Number.MAX_SAFE_INTEGER - i, type: a.quantity < 0 ? "sale" : "purchase", quantity: a.quantity, value: 0 })),
    ];
    const next = replayCosts(hypothetical, price);
    if (next.lowestQuantity < Math.min(0, current.lowestQuantity) - EPS) {
      const requested = round3(add.filter((a) => a.itemId === itemId && a.quantity < 0).reduce((s, a) => s - a.quantity, 0));
      throw tooLow(item.name, next.lowestQuantity, next.lowestDate, requested);
    }
  }
}

/** Refuses a document that would take more out of stock than there is (on its date, and from then on), unless negative stock is allowed. */
export async function assertStockAvailable(tenantId: string, lines: { itemId?: string | null; quantity: number }[], opts: { date: string; excludeSource?: { sourceType: string; sourceId?: string } }) {
  await assertStockTimeline(tenantId, { add: lines.filter((l) => l.quantity > 0).map((l) => ({ itemId: l.itemId, date: opts.date, quantity: -l.quantity })), excludeSource: opts.excludeSource });
}

// The movements of a source that are still in force: not themselves an undoing, and not yet undone.
async function activeMovements(tenantId: string, sourceType: string, sourceId: string) {
  const all = await db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.sourceType, sourceType), eq(stockMovements.sourceId, sourceId)));
  const reversed = new Set(all.filter((m) => m.reversalOfId).map((m) => m.reversalOfId));
  return all.filter((m) => !m.reversalOfId && !reversed.has(m.id));
}

/**
 * Undoes everything a document did to stock (a void, or the first half of an edit): each movement is cancelled by an equal and
 * opposite one that points back at it, so the exact quantity AND cost come back out. Where that takes stock out (undoing a
 * purchase or a sales return), it is refused if the goods are no longer there, unless negative stock is allowed.
 */
export async function unwindStock(tenantId: string, ctx: Omit<StockCtx, "type">, opts: { allowNegative?: boolean } = {}): Promise<number> {
  const active = await activeMovements(tenantId, ctx.sourceType, ctx.sourceId);
  if (active.length === 0) return 0;
  const allowNegative = opts.allowNegative ?? (await getAllowNegativeStock(tenantId));

  await db.transaction(async (tx) => {
    for (const m of active) {
      const item = await lockItem(tx, tenantId, m.itemId);
      const q = -Number(m.quantity);
      if (q < 0 && !allowNegative && Number(item.stockQuantity) + q < -EPS) {
        throw new Error(`Only ${Number(item.stockQuantity)} of ${item.name} in stock — some of these goods have already been sold or returned`);
      }
      await applyMovement(tx, tenantId, { ...ctx, type: m.type as MovementType }, m.itemId, q, -Number(m.value), { reversalOfId: m.id });
    }
  });
  return active.length;
}

/** Everything the stock cards say about one item, oldest first — its quantity and value running as it goes. */
export async function getStockCard(tenantId: string, itemId: string) {
  const rows = await db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId)));
  rows.sort((a, b) => (a.movementDate < b.movementDate ? -1 : a.movementDate > b.movementDate ? 1 : a.createdAt.getTime() - b.createdAt.getTime()));
  let qty = 0;
  let value = 0;
  return rows.map((m) => {
    qty = round3(qty + Number(m.quantity));
    value = round2(value + Number(m.value));
    return { id: m.id, date: m.movementDate, type: m.type, sourceType: m.sourceType, sourceId: m.sourceId, isReversal: Boolean(m.reversalOfId), isRecost: Boolean(m.recostOfId), note: m.note, quantity: Number(m.quantity), value: Number(m.value), balanceQuantity: qty, balanceValue: value };
  });
}

/**
 * Every item a document names must be this organization's, and an inactive item can't be put on a new document (\`stillAllowed\`
 * are items already on the document being edited). \`requireItem\` refuses lines with no item at all — a stockable purchase
 * puts value into Inventory, so each line has to say which item it is for.
 */
export async function assertItemsUsable(tenantId: string, lines: { itemId?: string | null }[], opts: { requireItem?: boolean; stillAllowed?: (string | null | undefined)[] } = {}) {
  if (opts.requireItem && lines.some((l) => !l.itemId)) {
    throw new Error("Every line on a stockable purchase must be an item — choose the item, or record this as a consumable purchase");
  }
  const ids = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const rows = await db.select({ id: items.id, name: items.name, isActive: items.isActive }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)));
  const allowed = new Set((opts.stillAllowed ?? []).filter(Boolean));
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("An item on this document was not found");
    if (!row.isActive && !allowed.has(id)) throw new Error(`${row.name} is inactive — make it active again before using it`);
  }
}
