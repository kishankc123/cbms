// The costing rules, with no database in them, so the live path (a document being saved) and the recalculation (history
// replayed in date order) can never disagree. Cost is a weighted average: stock value / quantity on hand.

export const EPS = 0.0005;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type StockState = { quantity: number; value: number };

/** What one unit costs right now: the average of what is on hand; when nothing is (or it is worth nothing), the item's standard price. */
export function unitCostOf(state: StockState, standardPrice: number) {
  return state.quantity > EPS && state.value > 0 ? state.value / state.quantity : standardPrice;
}

/**
 * The cost of taking `out` units out of stock. Units on hand come out at their average cost (the last of them clears the whole
 * remaining value); any units beyond what is on hand are costed at that average too, or the standard price if none is on hand.
 */
export function issueCost(state: StockState, out: number, standardPrice: number) {
  const onHand = state.quantity;
  const covered = Math.min(out, Math.max(onHand, 0));
  const coveredCost = covered <= EPS ? 0 : covered >= onHand - EPS ? state.value : round2((state.value * covered) / onHand);
  const beyond = round3(out - covered);
  return round2(coveredCost + (beyond > EPS ? beyond * unitCostOf(state, standardPrice) : 0));
}

export type MovementType = "opening" | "purchase" | "purchase_return" | "sale" | "sales_return" | "adjustment" | "recost";

/** Movements whose value is worked out from the stock at the time (a sale, goods coming back, stock written off); the rest carry their own value. */
export function isDerived(type: string, quantity: number) {
  return type === "sale" || type === "sales_return" || (type === "adjustment" && quantity < 0);
}

export type ReplayEvent = { id: string; date: string; order: number; type: string; quantity: number; value: number };

export type Replay = {
  /** The value each derived movement should have, replaying history in date order. */
  values: Map<string, number>;
  finalQuantity: number;
  finalValue: number;
  /** The lowest the quantity on hand ever gets, and the date it happens. */
  lowestQuantity: number;
  lowestDate: string | null;
};

/** Replays an item's movements in date order (then the order they were entered), recosting every derived one from the stock at that point. */
export function replayCosts(events: ReplayEvent[], standardPrice: number): Replay {
  // Date order; on the same day the opening balance comes first, then movements in the order they were entered.
  const rank = (e: ReplayEvent) => (e.type === "opening" ? 0 : 1);
  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b) || a.order - b.order));
  const state: StockState = { quantity: 0, value: 0 };
  const values = new Map<string, number>();
  let lowestQuantity = 0;
  let lowestDate: string | null = null;
  for (const e of sorted) {
    let value = e.value;
    if (isDerived(e.type, e.quantity)) {
      value = e.quantity < 0 ? -issueCost(state, -e.quantity, standardPrice) : round2(e.quantity * unitCostOf(state, standardPrice));
    }
    values.set(e.id, value);
    state.quantity = round3(state.quantity + e.quantity);
    state.value = round2(state.value + value);
    if (state.quantity < lowestQuantity - EPS) {
      lowestQuantity = state.quantity;
      lowestDate = e.date;
    }
  }
  return { values, finalQuantity: state.quantity, finalValue: state.value, lowestQuantity, lowestDate };
}
