"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, items } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { postJournalEntry, reverseAllActiveEntriesForSource } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { assertInventoryDate, assertStockTimeline, moveStock, unwindStock } from "@/lib/inventory/stock";
import { recalculateAfter } from "@/lib/inventory/recalc";
import { todayIso } from "@/lib/calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Stock written up or down lands here: a gain is income to the business (credit), a loss is an expense (debit).
async function getOrCreateInventoryAdjustmentAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["5920"], "Inventory Adjustment");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "5920", name: "Inventory Adjustments", category: "expense", subCategory: "Variable expenses" })
    .returning();
  return created;
}

function checkDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + "T00:00:00Z").getTime())) throw new Error("Enter a valid date");
  if (date > todayIso()) throw new Error("The date can't be in the future");
}

/**
 * Corrects stock to what was actually counted — damage, theft, a count difference. Taking stock out is valued at the average cost
 * (and can't be more than was on hand on that date); putting stock in is valued at the cost given (the average cost if not).
 * The difference goes to Inventory Adjustments; a reason is required and kept. It can't be dated before the Inventory Opening Date.
 */
export async function adjustStock(input: { itemId: string; quantityChange: number; unitCost?: number | null; date: string; reason: string }) {
  const session = await requireTenantSession();
  if (!can(session, "inventory", "edit")) throw new Error("Not permitted");
  const change = round3(input.quantityChange);
  if (change === 0 || !Number.isFinite(change)) throw new Error("Enter how many units to add or take out");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Give the reason for this adjustment");
  checkDate(input.date);
  const [item] = await db.select().from(items).where(and(eq(items.id, input.itemId), eq(items.tenantId, session.tenantId))).limit(1);
  if (!item) throw new Error("Item not found");
  await assertInventoryDate(session.tenantId, input.date, [{ itemId: item.id }]);
  await assertPeriodOpen(session.tenantId, input.date);

  let line: { itemId: string; quantity: number; value?: number };
  if (change > 0) {
    const onHand = Number(item.stockQuantity);
    const average = onHand > 0 && Number(item.stockValue) > 0 ? Number(item.stockValue) / onHand : Number(item.purchasePrice);
    const cost = input.unitCost ?? average;
    if (!Number.isFinite(cost) || cost < 0) throw new Error("The cost per unit can't be negative");
    line = { itemId: item.id, quantity: change, value: round2(change * cost) };
  } else {
    await assertStockTimeline(session.tenantId, { add: [{ itemId: item.id, date: input.date, quantity: change }] });
    line = { itemId: item.id, quantity: change };
  }

  const inventory = await findControlAccount(session.tenantId, ["1200"], "Inventory");
  if (!inventory) throw new Error("No Inventory account found — add one to the Chart of Accounts first");
  const adjustment = await getOrCreateInventoryAdjustmentAccount(session.tenantId);
  const sourceId = randomUUID();
  const ctx = { date: input.date, sourceType: "adjustment", sourceId, userId: session.userId, note: reason };

  const moved = await moveStock(session.tenantId, { ...ctx, type: "adjustment" }, [line], { allowNegative: change > 0 });
  const value = Math.abs(moved.value);
  try {
    if (value > 0) {
      const up = moved.value > 0;
      await postJournalEntry({
        tenantId: session.tenantId,
        entryDate: input.date,
        sourceType: "stock_adjustment",
        sourceId,
        referenceNumber: item.name,
        memo: `Stock adjustment - ${item.name}: ${reason}`,
        createdBy: session.userId,
        lines: [
          { accountId: inventory.id, ...(up ? { debitAmount: value } : { creditAmount: value }), description: `Stock adjustment - ${item.name}` },
          { accountId: adjustment.id, ...(up ? { creditAmount: value } : { debitAmount: value }), description: `Stock adjustment - ${item.name}` },
        ],
      });
    }
  } catch (e) {
    await unwindStock(session.tenantId, ctx, { allowNegative: true }).catch(() => {});
    await reverseAllActiveEntriesForSource(session.tenantId, sourceId, session.userId, "Rolled back — adjustment could not be saved").catch(() => {});
    throw e;
  }
  await recalculateAfter(session.tenantId, [item.id], session.userId, `Stock adjustment - ${item.name}`);
  for (const p of ["/inventory/items", "/inventory/stock", "/journal", "/dashboard", "/chart-of-accounts"]) revalidatePath(p);
}
