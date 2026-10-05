import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetCategories, assetEvents, assets, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { openingBalanceEntryDate } from "@/lib/ledger/opening-balance";
import { assetLedgerReconciliation, listOpeningAssets, recordOpeningAsset, updateOpeningAsset, voidOpeningAsset, type OpeningAssetInput } from "./opening";
import { ensureAssetSetup } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let categoryId: string;
let openingDate: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0) * 100) / 100;
}

const van = (over: Partial<OpeningAssetInput> = {}): OpeningAssetInput => ({
  name: "Delivery van",
  categoryId,
  originalPurchaseDate: "2020-01-15",
  cost: 5000000,
  accumulatedDepreciation: 2000000,
  method: "straight_line",
  originalUsefulLifeMonths: 100,
  remainingUsefulLifeMonths: 40,
  residualValue: 0,
  depreciationStartDate: null,
  ...over,
});

beforeAll(async () => {
  org = await createTempOrg("ZZ Asset Opening");
  await ensureAssetSetup(org.tenantId);
  categoryId = (await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId)))[0].id;
  openingDate = await openingBalanceEntryDate(org.tenantId);
});
afterAll(async () => {
  await org.remove();
});

describe("opening assets", () => {
  it("posts cost, accumulated depreciation and the net book value against the opening-balance account", async () => {
    const r = await recordOpeningAsset(org.tenantId, org.userId, van({ originalPurchaseDate: "2020-01-15", depreciationStartDate: openingDate }));
    // The temp org's books may start today; an asset bought in 2020 is before that either way.
    expect(r).toMatchObject({ ok: true, assetCode: "FA-000001" });
    if (!r.ok) return;

    const [asset] = await db.select().from(assets).where(eq(assets.id, r.assetId));
    expect(asset).toMatchObject({ status: "active", source: "opening", usefulLifeMonths: 40, originalUsefulLifeMonths: 100, lastDepreciationDate: null });
    expect(Number(asset.capitalizedCost)).toBe(5000000);
    expect(Number(asset.accumulatedDepreciation)).toBe(2000000);
    expect(Number(asset.openingAccumulatedDepreciation)).toBe(2000000);

    expect(await balance("1500")).toBe(5000000);
    expect(await balance("1590")).toBe(-2000000);
    expect(await balance("3200")).toBe(-3000000);

    const [entry] = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, r.assetId)));
    expect(entry).toMatchObject({ sourceType: "opening_balance", referenceNumber: "OPEN-FA-000001", entryDate: openingDate });
    const events = await db.select().from(assetEvents).where(eq(assetEvents.assetId, r.assetId));
    expect(events.map((e) => e.eventType)).toEqual(["opening_recorded"]);

    const rec = await assetLedgerReconciliation(org.tenantId);
    expect(rec).toMatchObject({ matches: true, registerCost: 5000000, ledgerCost: 5000000, registerAccumulated: 2000000, ledgerAccumulated: 2000000 });
  });

  it("an asset with nothing left to depreciate is recorded as fully depreciated", async () => {
    const r = await recordOpeningAsset(org.tenantId, org.userId, van({ name: "Old printer", cost: 50000, accumulatedDepreciation: 50000, remainingUsefulLifeMonths: null, depreciationStartDate: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await db.select().from(assets).where(eq(assets.id, r.assetId)))[0]).toMatchObject({ status: "fully_depreciated", usefulLifeMonths: null });
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);
  });

  it("refuses bad figures with a readable message and saves nothing", async () => {
    const before = (await db.select().from(assets).where(eq(assets.tenantId, org.tenantId))).length;
    const cases: [Partial<OpeningAssetInput>, RegExp][] = [
      [{ name: " " }, /asset name/i],
      [{ originalPurchaseDate: "2999-01-01" }, /before your books/i],
      [{ cost: 0 }, /original cost/i],
      [{ accumulatedDepreciation: 6000000 }, /more than the original cost/i],
      [{ remainingUsefulLifeMonths: null }, /remaining useful life/i],
      [{ assetCode: "FA-000001" }, /already used/i],
    ];
    for (const [over, pattern] of cases) {
      const r = await recordOpeningAsset(org.tenantId, org.userId, van({ depreciationStartDate: openingDate, ...over }));
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toMatch(pattern);
    }
    expect((await db.select().from(assets).where(eq(assets.tenantId, org.tenantId))).length).toBe(before);
  });

  it("editing reverses and reposts the entry, so the ledger follows the corrected figures", async () => {
    const r = await recordOpeningAsset(org.tenantId, org.userId, van({ name: "Forklift", cost: 100000, accumulatedDepreciation: 40000, remainingUsefulLifeMonths: 30, depreciationStartDate: openingDate }));
    if (!r.ok) throw new Error("setup failed");
    const cost0 = await balance("1500");
    const accum0 = await balance("1590");
    const equity0 = await balance("3200");

    const u = await updateOpeningAsset(org.tenantId, org.userId, r.assetId, van({ name: "Forklift", cost: 120000, accumulatedDepreciation: 50000, remainingUsefulLifeMonths: 30, depreciationStartDate: openingDate }));
    expect(u).toMatchObject({ ok: true });
    expect((await balance("1500")) - cost0).toBe(20000);
    expect((await balance("1590")) - accum0).toBe(-10000);
    expect((await balance("3200")) - equity0).toBe(-10000);
    expect(Number((await db.select().from(assets).where(eq(assets.id, r.assetId)))[0].capitalizedCost)).toBe(120000);
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);
    const events = await db.select().from(assetEvents).where(eq(assetEvents.assetId, r.assetId));
    expect(events.map((e) => e.eventType).sort()).toEqual(["opening_corrected", "opening_recorded"]);
  });

  it("can be voided before depreciation, and not once depreciation has been posted", async () => {
    const r = await recordOpeningAsset(org.tenantId, org.userId, van({ name: "Mistake", cost: 10000, accumulatedDepreciation: 0, remainingUsefulLifeMonths: 20, depreciationStartDate: openingDate }));
    if (!r.ok) throw new Error("setup failed");
    const cost0 = await balance("1500");
    expect(await voidOpeningAsset(org.tenantId, org.userId, r.assetId)).toEqual({ ok: true });
    expect((await db.select().from(assets).where(eq(assets.id, r.assetId)))[0].status).toBe("voided");
    expect(cost0 - (await balance("1500"))).toBe(10000);
    expect(await voidOpeningAsset(org.tenantId, org.userId, r.assetId)).toMatchObject({ ok: false });
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);

    const two = await recordOpeningAsset(org.tenantId, org.userId, van({ name: "Depreciated", cost: 10000, accumulatedDepreciation: 0, remainingUsefulLifeMonths: 20, depreciationStartDate: openingDate }));
    if (!two.ok) throw new Error("setup failed");
    await db.update(assets).set({ lastDepreciationDate: "2026-09-30" }).where(eq(assets.id, two.assetId));
    const blocked = await voidOpeningAsset(org.tenantId, org.userId, two.assetId);
    expect(blocked).toMatchObject({ ok: false });
    expect((blocked as { error: string }).error).toMatch(/depreciation/i);
    const edit = await updateOpeningAsset(org.tenantId, org.userId, two.assetId, van({ cost: 20000, remainingUsefulLifeMonths: 20, depreciationStartDate: openingDate }));
    expect(edit).toMatchObject({ ok: false });
  });

  it("lists opening assets with their net book value", async () => {
    const list = await listOpeningAssets(org.tenantId);
    expect(list.find((a) => a.name === "Delivery van")).toMatchObject({ cost: 5000000, accumulated: 2000000, netBookValue: 3000000 });
  });
});
