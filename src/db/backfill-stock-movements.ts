// One-time migration to stock movements and stock value. Before this, an item only carried a running quantity, and the cost of
// goods sold used the item's standard purchase price. This rebuilds each item's history from the documents that are still in
// force and values it from what the ledger actually booked:
//   - purchases: the amount the bill debited to Inventory, shared over its item lines
//   - sales: the cost of goods sold booked on the invoice, shared over its item lines
//   - sales returns / purchase returns: the Inventory amount their entries posted
// and then sets each item's stock value to the total. If an item's quantity doesn't match what its documents say, the difference
// is brought in as an opening movement (so quantities never change). Finally it reports how the total compares with the
// Inventory account, so anything not backed by an item is visible.
//
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/backfill-stock-movements.ts          (dry run)
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/backfill-stock-movements.ts --apply
//
// Idempotent: an item that already has movements is left alone.
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { accounts, items, journalEntries, journalLines, purchaseBills, purchaseReturns, salesInvoices, salesReturns, stockMovements, tenants } from "./schema";
import { allocateProportional } from "../lib/inventory/stock";

const apply = process.argv.includes("--apply");
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type Event = { itemId: string; date: string; type: "purchase" | "purchase_return" | "sale" | "sales_return"; sourceType: string; sourceId: string; quantity: number; value: number; order: number };

async function main() {
  for (const tenant of await db.select().from(tenants)) {
    const tenantItems = await db.select().from(items).where(eq(items.tenantId, tenant.id));
    if (tenantItems.length === 0) continue;
    const existing = new Set((await db.select({ id: stockMovements.itemId }).from(stockMovements).where(eq(stockMovements.tenantId, tenant.id))).map((m) => m.id));
    const todo = tenantItems.filter((i) => !existing.has(i.id));
    if (todo.length === 0) continue;
    const todoIds = new Set(todo.map((i) => i.id));
    const priceOf = new Map(tenantItems.map((i) => [i.id, Number(i.purchasePrice)]));

    const [inventory] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenant.id), eq(accounts.code, "1200")));
    // What each source's entries in force put into (+) or took out of (-) Inventory.
    const inventoryBySource = new Map<string, number>();
    let ledger = 0;
    if (inventory) {
      const rows = await db
        .select({ sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, d: journalLines.debitAmount, c: journalLines.creditAmount })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
        .where(and(eq(journalEntries.tenantId, tenant.id), eq(journalLines.accountId, inventory.id)));
      for (const r of rows) {
        const amount = Number(r.d) - Number(r.c);
        ledger += amount;
        if (r.sourceId) inventoryBySource.set(`${r.sourceType}:${r.sourceId}`, round2((inventoryBySource.get(`${r.sourceType}:${r.sourceId}`) ?? 0) + amount));
      }
    }

    const events: Event[] = [];
    let order = 0;
    const share = (total: number, lines: { itemId?: string | null; weight: number }[]) => allocateProportional(total, lines.map((l) => l.weight));

    for (const b of await db.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, tenant.id)))) {
      if (b.status === "void") continue;
      const lines = (b.lineItems ?? []).filter((l) => l.quantity > 0);
      if (!lines.some((l) => l.itemId)) continue;
      const total = inventoryBySource.get(`purchase:${b.id}`) ?? 0;
      const parts = share(total, lines.map((l) => ({ itemId: l.itemId, weight: l.rate * l.quantity - (l.discount ?? 0) })));
      lines.forEach((l, i) => l.itemId && todoIds.has(l.itemId) && events.push({ itemId: l.itemId, date: b.billDate, type: "purchase", sourceType: "purchase", sourceId: b.id, quantity: l.quantity, value: parts[i], order: order++ }));
    }
    for (const r of await db.select().from(purchaseReturns).where(eq(purchaseReturns.tenantId, tenant.id))) {
      if (r.status === "void") continue;
      const lines = (r.lineItems ?? []).filter((l) => l.quantity > 0);
      if (!lines.some((l) => l.itemId)) continue;
      const total = Math.abs(inventoryBySource.get(`purchase_return:${r.id}`) ?? 0);
      const parts = share(total, lines.map((l) => ({ itemId: l.itemId, weight: l.rate * l.quantity - (l.discount ?? 0) })));
      lines.forEach((l, i) => l.itemId && todoIds.has(l.itemId) && events.push({ itemId: l.itemId, date: r.noteDate, type: "purchase_return", sourceType: "purchase_return", sourceId: r.id, quantity: -l.quantity, value: -parts[i], order: order++ }));
    }
    for (const inv of await db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id))) {
      if (inv.status === "void") continue;
      const lines = ((inv.lineItems ?? []) as { itemId?: string | null; quantity: number }[]).filter((l) => l.quantity > 0);
      if (!lines.some((l) => l.itemId)) continue;
      const cost = Math.abs(inventoryBySource.get(`expense:${inv.id}`) ?? 0);
      const parts = share(cost, lines.map((l) => ({ itemId: l.itemId, weight: l.itemId ? l.quantity * (priceOf.get(l.itemId) ?? 0) || l.quantity : 0 })));
      lines.forEach((l, i) => l.itemId && todoIds.has(l.itemId) && events.push({ itemId: l.itemId, date: inv.invoiceDate, type: "sale", sourceType: "sale", sourceId: inv.id, quantity: -l.quantity, value: -parts[i], order: order++ }));
    }
    for (const r of await db.select().from(salesReturns).where(eq(salesReturns.tenantId, tenant.id))) {
      if (r.status === "void") continue;
      const lines = ((r.lineItems ?? []) as { itemId?: string | null; quantity: number }[]).filter((l) => l.quantity > 0);
      if (!lines.some((l) => l.itemId)) continue;
      const cost = Math.abs(inventoryBySource.get(`sales_return:${r.id}`) ?? 0);
      const parts = share(cost, lines.map((l) => ({ itemId: l.itemId, weight: l.itemId ? l.quantity * (priceOf.get(l.itemId) ?? 0) || l.quantity : 0 })));
      lines.forEach((l, i) => l.itemId && todoIds.has(l.itemId) && events.push({ itemId: l.itemId, date: r.noteDate, type: "sales_return", sourceType: "sales_return", sourceId: r.id, quantity: l.quantity, value: parts[i], order: order++ }));
    }
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

    let totalValue = 0;
    console.log(`\n${tenant.id}: ${todo.length} item(s) to migrate`);
    for (const item of todo) {
      const mine = events.filter((e) => e.itemId === item.id);
      const qty = round3(mine.reduce((s, e) => s + e.quantity, 0));
      const value = round2(mine.reduce((s, e) => s + e.value, 0));
      const diff = round3(Number(item.stockQuantity) - qty);
      const opening = diff !== 0 ? { quantity: diff, value: round2(diff * Number(item.purchasePrice)) } : null;
      const finalValue = round2(value + (opening?.value ?? 0));
      totalValue += finalValue;
      console.log(`  ${item.name}: documents say qty ${qty}, on record ${item.stockQuantity}${opening ? ` -> opening movement ${opening.quantity} worth ${opening.value}` : ""}; value ${finalValue}`);
      if (!apply) continue;
      if (opening) {
        await db.insert(stockMovements).values({ tenantId: tenant.id, itemId: item.id, movementDate: mine[0]?.date ?? new Date().toISOString().slice(0, 10), type: "opening", quantity: opening.quantity.toFixed(3), value: opening.value.toFixed(2), sourceType: "opening", sourceId: item.id, note: "Balance brought forward when stock history was introduced" });
      }
      if (mine.length > 0) {
        await db.insert(stockMovements).values(mine.map((e) => ({ tenantId: tenant.id, itemId: item.id, movementDate: e.date, type: e.type, quantity: e.quantity.toFixed(3), value: e.value.toFixed(2), sourceType: e.sourceType, sourceId: e.sourceId })));
      }
      await db.update(items).set({ stockValue: finalValue.toFixed(2) }).where(and(eq(items.id, item.id), eq(items.tenantId, tenant.id)));
    }
    const otherValue = tenantItems.filter((i) => !todoIds.has(i.id)).reduce((s, i) => s + Number(i.stockValue), 0);
    console.log(`  Inventory account: ${round2(ledger)}   stock value of all items: ${round2(totalValue + otherValue)}   difference: ${round2(ledger - totalValue - otherValue)}`);
  }
  console.log(apply ? "\nDone." : "\nDry run — re-run with --apply to write.");
  process.exit(0);
}
main();

