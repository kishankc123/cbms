import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetDisposals, assets, taxDeferredAdditions } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { ensureAssetSetup } from "@/lib/assets/setup";
import { finaliseTaxYear, previewTaxYear, reopenTaxYear } from "./year";
import { saveOpeningPool } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let catId: Record<string, string>;
const Y = 2082; // 2025-07-17 to 2026-07-16

async function addAsset(code: string, category: string, cost: number, purchaseDate: string | null, source: "purchase" | "opening" = "purchase") {
  const [a] = await db.insert(assets).values({ tenantId: org.tenantId, assetCode: code, name: code, categoryId: catId[category], status: "active", source, purchaseDate, availableForUseDate: purchaseDate, purchasePrice: String(cost), capitalizedCost: String(cost), depreciationMethod: "none" }).returning({ id: assets.id });
  return a.id;
}
const poolOf = async (year: number, key: string) => {
  const r = await previewTaxYear(org.tenantId, year);
  if (!r.ok) throw new Error(r.error);
  return { preview: r.preview, pool: r.preview.pools.find((p) => p.key === key) };
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Tax depreciation year");
  await ensureAssetSetup(org.tenantId);
  const cats = await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId));
  catId = Object.fromEntries(cats.map((c) => [c.name, c.id]));
});
afterAll(async () => {
  await org.remove();
});

describe("a tax year from the asset register", () => {
  it("counts a late-year purchase as part addition, defers the rest, and keeps opening-year purchases out of the opening balance", async () => {
    expect(await saveOpeningPool(org.tenantId, org.userId, { taxYear: Y, poolKey: "B", assetId: null, openingWdv: 100000, note: "" })).toEqual({ ok: true });
    await addAsset("OLD-PC", "Computer & IT Equipment", 80000, "2023-01-01", "opening"); // already inside the opening balance
    await addAsset("NEW-PC", "Computer & IT Equipment", 60000, "2026-03-01"); // Falgun: 2/3
    const { pool } = await poolOf(Y, "B");
    expect(pool!.result.additionLines).toHaveLength(1);
    expect(pool!.result).toMatchObject({ openingWdv: 100000, currentYearAdditions: 40000, deferredAdditions: 20000, depreciationBase: 140000, normalDepreciation: 35000, closingWdv: 105000 });
  });

  it("a class whose only asset is sold is dissolved: proceeds above the value are a balancing charge", async () => {
    expect(await saveOpeningPool(org.tenantId, org.userId, { taxYear: Y, poolKey: "A", assetId: null, openingWdv: 50000, note: "" })).toEqual({ ok: true });
    const building = await addAsset("BLD-1", "Building", 90000, "2020-01-01", "opening");
    await db.insert(assetDisposals).values({ tenantId: org.tenantId, assetId: building, kind: "sale", reference: "DSP-T1", disposalDate: "2026-04-01", saleAmount: "80000", total: "80000", cost: "90000", accumulatedDepreciation: "40000", netBookValue: "50000", gainLoss: "30000", status: "posted" });
    const { pool } = await poolOf(Y, "A");
    expect(pool!.result).toMatchObject({ dissolved: true, balancingCharge: 30000, terminalDeduction: 0, closingWdv: 0 });
    expect(pool!.result.reviewFlags.join(" ")).toMatch(/dissolved/);
  });

  it("is blocked by an asset with no date, and by an intangible with no period of use", async () => {
    const noDate = await addAsset("NODATE", "Office Equipment", 1000, null);
    await addAsset("SOFT-1", "Intangible Assets", 30000, "2025-09-01");
    const r = await previewTaxYear(org.tenantId, Y);
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.blocking.join(" ")).toMatch(/NODATE.*no purchase or available-for-use date/);
    expect(r.preview.blocking.join(" ")).toMatch(/period of use/);
    expect(await finaliseTaxYear(org.tenantId, org.userId, Y)).toMatchObject({ ok: false, error: expect.stringMatching(/Fix these first/) });
    await db.delete(assets).where(eq(assets.id, noDate));
    await db.delete(assets).where(and(eq(assets.tenantId, org.tenantId), eq(assets.assetCode, "SOFT-1")));
  });
});

describe("finalising, the next year and reopening", () => {
  it("saves the year with its rules, registers the deferred part, and carries the closing balance into next year", async () => {
    expect(await finaliseTaxYear(org.tenantId, org.userId, Y)).toEqual({ ok: true });
    expect(await finaliseTaxYear(org.tenantId, org.userId, Y)).toMatchObject({ ok: false, error: expect.stringMatching(/already finalised/) });
    const saved = await previewTaxYear(org.tenantId, Y);
    expect(saved.ok && saved.preview.final).toBeTruthy();
    expect(saved.ok && saved.preview.rules.legalReference).toMatch(/2058/);

    const rows = await db.select().from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, org.tenantId), eq(taxDeferredAdditions.source, "calculated")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ poolKey: "B", dueTaxYear: Y + 1, status: "pending" });
    expect(Number(rows[0].remainingDeferred)).toBe(20000);

    const next = await poolOf(Y + 1, "B");
    expect(next.pool!.result).toMatchObject({ openingWdv: 105000, priorDeferredReceived: 20000, depreciationBase: 125000, closingWdv: 93750 });
    // the dissolved class is gone: nothing carries on in A
    expect((await poolOf(Y + 1, "A")).pool).toBeUndefined();
  });

  it("includes the deferred amount once, and reopening puts everything back", async () => {
    expect(await finaliseTaxYear(org.tenantId, org.userId, Y + 1)).toEqual({ ok: true });
    const [row] = await db.select().from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, org.tenantId), eq(taxDeferredAdditions.source, "calculated")));
    expect(row).toMatchObject({ status: "included", includedInTaxYear: Y + 1 });
    // the earlier year can't be reopened while the later one stands
    expect(await reopenTaxYear(org.tenantId, org.userId, Y, "Correcting a disposal")).toMatchObject({ ok: false, error: expect.stringMatching(/latest/) });
    expect(await reopenTaxYear(org.tenantId, org.userId, Y + 1, "Correcting a disposal")).toEqual({ ok: true });
    const [again] = await db.select().from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, org.tenantId), eq(taxDeferredAdditions.source, "calculated")));
    expect(again).toMatchObject({ status: "pending", includedInTaxYear: null });

    expect(await reopenTaxYear(org.tenantId, org.userId, Y, "Correcting a disposal")).toEqual({ ok: true });
    expect(await db.select().from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, org.tenantId), eq(taxDeferredAdditions.source, "calculated")))).toHaveLength(0);
    // and it can be finalised again
    expect(await finaliseTaxYear(org.tenantId, org.userId, Y)).toEqual({ ok: true });
  });
});
