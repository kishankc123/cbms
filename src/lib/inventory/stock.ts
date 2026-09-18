import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";

// Applies a signed quantity delta to each line's linked item's running stock
// — sign +1 for a purchase (goods received), -1 for a sale (goods shipped).
// Lines without an itemId (free-typed, or a Consumable purchase's category
// rows) are skipped, since only real inventory items carry a stock balance.
export async function applyStockDelta(
  tenantId: string,
  lines: { itemId?: string | null; quantity: number }[],
  sign: 1 | -1
) {
  for (const line of lines) {
    if (!line.itemId || !line.quantity) continue;
    await db
      .update(items)
      .set({ stockQuantity: sql`${items.stockQuantity} + ${sign * line.quantity}` })
      .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)));
  }
}

// Total cost of goods sold across the given lines, using each item's current
// purchasePrice as its unit cost — items with no itemId (free-typed lines)
// contribute no COGS, since there's no cost basis for them.
export async function computeCogsTotal(
  tenantId: string,
  lines: { itemId?: string | null; quantity: number }[]
) {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => Boolean(id)))];
  if (itemIds.length === 0) return 0;

  const rows = await db
    .select({ id: items.id, purchasePrice: items.purchasePrice })
    .from(items)
    .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
  const priceById = new Map(rows.map((r) => [r.id, Number(r.purchasePrice)]));

  let total = 0;
  for (const line of lines) {
    if (!line.itemId) continue;
    total += (priceById.get(line.itemId) ?? 0) * line.quantity;
  }
  return Math.round(total * 100) / 100;
}
