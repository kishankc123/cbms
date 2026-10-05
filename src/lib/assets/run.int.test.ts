import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetCategories, assetEvents, assets, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { cashFlowStatement } from "@/lib/ledger/reports";
import { assetLedgerReconciliation, recordOpeningAsset, type OpeningAssetInput } from "./opening";
import { listRuns, postDepreciationRun, previewRun, reverseDepreciationRun } from "./run";
import { ensureAssetSetup } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let categoryId: string;
const AD = "AD" as const;
const JUL = "2026-07-01";
const AUG = "2026-08-01";
const SEP = "2026-09-01";
const OCT = "2026-10-01";

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
const assetNamed = async (name: string) => (await db.select().from(assets).where(and(eq(assets.tenantId, org.tenantId), eq(assets.name, name))))[0];

async function addAsset(name: string, cost: number, months: number, start: string) {
  const input: OpeningAssetInput = { name, categoryId, originalPurchaseDate: "2020-01-15", cost, accumulatedDepreciation: 0, method: "straight_line", originalUsefulLifeMonths: months, remainingUsefulLifeMonths: months, residualValue: 0, depreciationStartDate: start };
  const r = await recordOpeningAsset(org.tenantId, org.userId, input);
  if (!r.ok) throw new Error(r.error);
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Asset Run");
  await ensureAssetSetup(org.tenantId);
  categoryId = (await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId)))[0].id;
  await addAsset("Asset A", 120000, 12, "2026-07-10"); // 10,000 a month from July
  await addAsset("Asset B", 60000, 6, "2026-08-05"); // 10,000 a month from August
});
afterAll(async () => {
  await org.remove();
});

describe("monthly depreciation runs", () => {
  it("previews what is due, with late assets catching up", async () => {
    const jul = await previewRun(org.tenantId, AD, JUL);
    expect(jul.blocked).toBeNull();
    expect(jul.lines.map((l) => [l.assetCode, l.amount])).toEqual([["FA-000001", 10000]]);
    const aug = await previewRun(org.tenantId, AD, AUG);
    expect(aug.total).toBe(30000);
    expect(aug.lines.find((l) => l.assetCode === "FA-000001")).toMatchObject({ months: 2, amount: 20000, accumulatedAfter: 20000, netBookValueAfter: 100000 });
    expect((await previewRun(org.tenantId, AD, OCT)).blocked).toMatch(/hasn't ended/);
  });

  it("posts one entry for every asset, and moves each asset's running figures", async () => {
    const r = await postDepreciationRun(org.tenantId, org.userId, AD, AUG);
    expect(r).toMatchObject({ ok: true, runNumber: 1, total: 30000, assetCount: 2 });
    expect(await balance("5500")).toBe(30000);
    expect(await balance("1590")).toBe(-30000);
    const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, "asset_depreciation")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ referenceNumber: "DEP-000001", entryDate: "2026-08-31" });

    const a = await assetNamed("Asset A");
    expect(a).toMatchObject({ accumulatedDepreciation: "20000.00", lastDepreciationDate: "2026-08-31", status: "active" });
    expect(await db.select().from(assetEvents).where(and(eq(assetEvents.assetId, a.id), eq(assetEvents.eventType, "depreciation_posted")))).toHaveLength(1);
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);
  });

  it("runs go in order: the same or an earlier month can't be run again", async () => {
    for (const month of [AUG, JUL]) {
      const r = await postDepreciationRun(org.tenantId, org.userId, AD, month);
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toMatch(/already been run through/);
    }
    expect((await postDepreciationRun(org.tenantId, org.userId, AD, OCT)).ok).toBe(false);
    expect(await balance("5500")).toBe(30000);
  });

  it("an asset that depreciates to its residual value becomes fully depreciated, and reversing gives it back", async () => {
    await addAsset("Asset C", 20000, 1, "2026-09-03");
    const r = await postDepreciationRun(org.tenantId, org.userId, AD, SEP);
    expect(r).toMatchObject({ ok: true, runNumber: 2, total: 40000 });
    expect(await assetNamed("Asset C")).toMatchObject({ status: "fully_depreciated", accumulatedDepreciation: "20000.00" });
    if (!r.ok) return;

    // only the latest run can be reversed
    const first = (await listRuns(org.tenantId)).find((x) => x.runNumber === 1)!;
    expect(await reverseDepreciationRun(org.tenantId, org.userId, first.id)).toMatchObject({ ok: false });

    expect(await reverseDepreciationRun(org.tenantId, org.userId, r.runId)).toEqual({ ok: true });
    expect(await assetNamed("Asset C")).toMatchObject({ status: "active", accumulatedDepreciation: "0.00", lastDepreciationDate: null });
    expect(await assetNamed("Asset A")).toMatchObject({ accumulatedDepreciation: "20000.00", lastDepreciationDate: "2026-08-31" });
    expect(await balance("5500")).toBe(30000);
    expect(await balance("1590")).toBe(-30000);
    expect(await reverseDepreciationRun(org.tenantId, org.userId, r.runId)).toMatchObject({ ok: false });

    // the freed month can be run again
    expect(await postDepreciationRun(org.tenantId, org.userId, AD, SEP)).toMatchObject({ ok: true, runNumber: 3, total: 40000 });
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);
  });

  it("cash flow adds depreciation back as non-cash instead of showing it as investing", async () => {
    const cf = await cashFlowStatement(org.tenantId, new Date("2026-01-01"), new Date("2026-10-06"));
    expect(cf.isBalanced).toBe(true);
    expect(cf.operating.find((l) => l.name === "Depreciation (non-cash)")?.amount).toBe(70000);
    expect(cf.investing.some((l) => l.name === "Accumulated Depreciation")).toBe(false);
  });
});
