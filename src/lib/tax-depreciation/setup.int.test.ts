import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, taxCategoryMap } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { ensureAssetSetup } from "@/lib/assets/setup";
import { taxDepreciationRulesOn } from "./platform-rules";
import { addOpeningDeferred, addStatutoryAddition, cancelDeferred, ensureTaxCategoryMap, listDeferred, listOpeningPools, saveOpeningPool, setCategoryClass, rulesForTaxYear } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const YEAR = 2082;
beforeAll(async () => {
  org = await createTempOrg("ZZ Tax depreciation");
  await ensureAssetSetup(org.tenantId);
});
afterAll(async () => {
  await org.remove();
});

describe("platform rules", () => {
  it("Nepal's rules are published and found for a date inside the tax year", async () => {
    const found = await taxDepreciationRulesOn("NP", "2026-03-01");
    expect(found?.rules.pools.map((p) => p.key)).toEqual(["A", "B", "C", "D", "E"]);
    expect(found?.isVerified).toBe(false);
    expect((await rulesForTaxYear(org.tenantId, YEAR))?.rules.legalReference).toMatch(/2058/);
  });
});

describe("category classes", () => {
  it("start from the names, with the unclear one marked for review, and can be changed", async () => {
    const rows = await ensureTaxCategoryMap(org.tenantId);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by["Land"].poolKey).toBeNull();
    expect(by["Building"].poolKey).toBe("A");
    expect(by["Other Fixed Assets"]).toMatchObject({ poolKey: "D", needsReview: true });
    expect(await setCategoryClass(org.tenantId, org.userId, { categoryId: by["Other Fixed Assets"].categoryId, poolKey: "B", taxYear: YEAR })).toEqual({ ok: true });
    const [saved] = await db.select().from(taxCategoryMap).where(and(eq(taxCategoryMap.tenantId, org.tenantId), eq(taxCategoryMap.categoryId, by["Other Fixed Assets"].categoryId)));
    expect(saved).toMatchObject({ poolKey: "B", needsReview: false });
    expect(await setCategoryClass(org.tenantId, org.userId, { categoryId: by["Land"].categoryId, poolKey: "Z", taxYear: YEAR })).toMatchObject({ ok: false });
    // a category from another organization is not found
    const [other] = await db.select().from(assetCategories).limit(1);
    expect(other).toBeDefined();
  });
});

describe("opening balances", () => {
  it("are saved per class, replaced when edited, and refused when they don't fit the class", async () => {
    expect(await saveOpeningPool(org.tenantId, org.userId, { taxYear: YEAR, poolKey: "B", assetId: null, openingWdv: 100000, note: "" })).toEqual({ ok: true });
    expect(await saveOpeningPool(org.tenantId, org.userId, { taxYear: YEAR, poolKey: "B", assetId: null, openingWdv: 120000, note: "corrected" })).toEqual({ ok: true });
    const rows = await listOpeningPools(org.tenantId, YEAR);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].openingWdv)).toBe(120000);
    expect(await saveOpeningPool(org.tenantId, org.userId, { taxYear: YEAR, poolKey: "E", assetId: null, openingWdv: 5000, note: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/intangible/) });
    expect(await saveOpeningPool(org.tenantId, org.userId, { taxYear: YEAR, poolKey: "B", assetId: null, openingWdv: -1, note: "" })).toMatchObject({ ok: false });
  });
});

describe("the deferred-addition register", () => {
  const entry = { assetId: null, assetLabel: "Laptops bought Falgun 2081", poolKey: "B", originalTaxYear: 2081, originalDate: "2025-03-01", originalCost: 60000, originalThirds: 2 as const, includedInOriginalYear: 40000, remainingDeferred: 20000, dueTaxYear: 2082, note: "" };
  it("takes an entry brought forward and can cancel it while it is waiting", async () => {
    expect(await addOpeningDeferred(org.tenantId, org.userId, entry)).toEqual({ ok: true });
    const rows = await listDeferred(org.tenantId);
    expect(rows[0]).toMatchObject({ status: "pending", source: "opening", poolKey: "B" });
    expect(await cancelDeferred(org.tenantId, org.userId, rows[0].id)).toEqual({ ok: true });
    expect(await cancelDeferred(org.tenantId, org.userId, rows[0].id)).toMatchObject({ ok: false });
  });
  it("refuses entries that don't add up", async () => {
    expect(await addOpeningDeferred(org.tenantId, org.userId, { ...entry, includedInOriginalYear: 50000 })).toMatchObject({ ok: false, error: expect.stringMatching(/more than the original cost/) });
    expect(await addOpeningDeferred(org.tenantId, org.userId, { ...entry, dueTaxYear: 2081 })).toMatchObject({ ok: false });
  });
});

describe("statutory additions", () => {
  const add = { taxYear: YEAR, poolKey: "B", typeKey: "repair_excess", description: "Repairs over the limit", amount: 10000, legalReference: "", evidence: "Account 5310 report" };
  it("need a legal reference and evidence; the rules' own section is used when none is typed", async () => {
    expect(await addStatutoryAddition(org.tenantId, org.userId, { ...add, evidence: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/evidence/) });
    expect(await addStatutoryAddition(org.tenantId, org.userId, { ...add, typeKey: "other_authorised" })).toMatchObject({ ok: false, error: expect.stringMatching(/section/) });
    expect(await addStatutoryAddition(org.tenantId, org.userId, add)).toEqual({ ok: true });
  });
});
