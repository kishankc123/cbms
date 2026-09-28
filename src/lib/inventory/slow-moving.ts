import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { items, stockMovements } from "@/db/schema";

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (asOfStr: string, dateStr: string) => Math.round((new Date(asOfStr + "T00:00:00Z").getTime() - new Date(dateStr + "T00:00:00Z").getTime()) / 86400000);

export type SlowMovingRow = {
  itemId: string;
  name: string;
  quantity: number;
  stockValue: number;
  lastMovementDate: string | null;
  daysSinceMovement: number | null;
};

/**
 * Tracked items still holding stock whose most recent stock movement (any type — purchase, sale,
 * adjustment) is older than `thresholdDays`, or that have never moved at all. Sorted most-stagnant
 * first, so it reads as a worklist: what to review, discount, or write off.
 */
export async function slowMovingStock(tenantId: string, asOf: Date, thresholdDays: number): Promise<SlowMovingRow[]> {
  const asOfStr = toDateStr(asOf);

  const trackedItems = await db
    .select({ id: items.id, name: items.name, stockQuantity: items.stockQuantity, stockValue: items.stockValue })
    .from(items)
    .where(and(eq(items.tenantId, tenantId), eq(items.inventoryTracking, true), eq(items.isActive, true)));

  const itemIds = trackedItems.map((i) => i.id);
  const movementRows =
    itemIds.length > 0
      ? await db
          .select({ itemId: stockMovements.itemId, movementDate: stockMovements.movementDate })
          .from(stockMovements)
          .where(and(eq(stockMovements.tenantId, tenantId), inArray(stockMovements.itemId, itemIds), lte(stockMovements.movementDate, asOfStr)))
      : [];

  const lastMovementByItem = new Map<string, string>();
  for (const m of movementRows) {
    const current = lastMovementByItem.get(m.itemId);
    if (!current || m.movementDate > current) lastMovementByItem.set(m.itemId, m.movementDate);
  }

  return trackedItems
    .map((i) => {
      const lastMovementDate = lastMovementByItem.get(i.id) ?? null;
      const daysSinceMovement = lastMovementDate ? daysBetween(asOfStr, lastMovementDate) : null;
      return { itemId: i.id, name: i.name, quantity: Number(i.stockQuantity), stockValue: Number(i.stockValue), lastMovementDate, daysSinceMovement };
    })
    .filter((r) => r.quantity > 0 && (r.daysSinceMovement === null || r.daysSinceMovement >= thresholdDays))
    .sort((a, b) => (b.daysSinceMovement ?? Infinity) - (a.daysSinceMovement ?? Infinity));
}
