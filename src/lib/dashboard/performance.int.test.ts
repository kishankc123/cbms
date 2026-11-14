import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, inventorySettings } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { loadPerformance } from "./performance";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const id: Record<string, string> = {};

const post = (date: string, debit: string, credit: string, amount: number) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "manual", createdBy: org.userId, lines: [{ accountId: id[debit], debitAmount: amount }, { accountId: id[credit], creditAmount: amount }] });
const setting = (values: { trackInventory?: boolean; overviewStockLossesInCogs?: boolean }) => db.insert(inventorySettings).values({ tenantId: org.tenantId, ...values }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: values });
const load = () => loadPerformance(org.tenantId, { from: "2026-03-01", to: "2026-03-31" }, "AD", "2026-04-05");

beforeAll(async () => {
  org = await createTempOrg("ZZ Overview performance");
  for (const code of ["1000", "1200", "4000", "5000", "5300.01"]) id[code] = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0].id;
  id["5920"] = (await db.insert(accounts).values({ tenantId: org.tenantId, code: "5920", name: "Inventory Adjustments", category: "expense", subCategory: "Indirect expenses" }).returning())[0].id;

  await post("2026-03-10", "1000", "4000", 1000); // March revenue
  await post("2026-03-10", "5000", "1200", 400); // March cost of goods sold
  await post("2026-03-12", "5300.01", "1000", 100); // March utilities
  await post("2026-03-20", "5920", "1200", 50); // a stock write-off
  await post("2026-02-10", "1000", "4000", 800); // the month before
  await post("2025-03-10", "1000", "4000", 500); // the same month a year ago
});
afterAll(async () => {
  await org.remove();
});

describe("Overview performance from the ledger", () => {
  it("sorts the ledger into revenue, cost of goods sold and expenses, and compares with the month before and a year ago", async () => {
    const p = await load();
    expect(p.current).toEqual({ revenue: 1000, cogs: 400, expenses: 150, gross: 600, net: 450 }); // the write-off is an expense by default
    expect(p.previous.totals.revenue).toBe(800);
    expect(p.lastYear.totals.revenue).toBe(500);
    expect(p.changes.previous.revenue).toMatchObject({ pct: 25, good: true });
    expect(p.changes.lastYear.revenue).toMatchObject({ pct: 100, good: true });
    expect(p.showCogs).toBe(true);
    // a young business: not enough finished months to expect anything
    expect(p.projection.revenue).toBeNull();
  });

  it("counts stock written off as cost of goods sold only when the Overview setting is on, without changing any posting", async () => {
    await setting({ overviewStockLossesInCogs: true });
    const p = await load();
    expect(p.current).toMatchObject({ cogs: 450, expenses: 100, net: 450 }); // profit is the same either way
    await setting({ overviewStockLossesInCogs: false });
  });

  it("an organization that keeps no stock has no cost of goods sold card, and what was posted there counts as an expense so profit stays right", async () => {
    await setting({ trackInventory: false });
    const p = await load();
    expect(p.showCogs).toBe(false);
    expect(p.current).toMatchObject({ cogs: 0, expenses: 550, net: 450 });
  });
});
