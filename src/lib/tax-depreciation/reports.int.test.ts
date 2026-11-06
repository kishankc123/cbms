import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetDepreciationLines, assetDepreciationRuns, assetDisposals, assets, notificationStates } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { ensureAssetSetup } from "@/lib/assets/setup";
import { loadNotifications } from "@/lib/notifications/notifications";
import { saveAssetTaxProfile, saveOpeningPool, setCategoryClass } from "./setup";
import { previewTaxYear } from "./year";
import { booksVsTax, currentTaxYearFor, reviewItems } from "./reports";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let catId: Record<string, string>;
const Y = 2082;

beforeAll(async () => {
  org = await createTempOrg("ZZ Tax depreciation reports");
  await ensureAssetSetup(org.tenantId);
  const cats = await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId));
  catId = Object.fromEntries(cats.map((c) => [c.name, c.id]));
});
afterAll(async () => {
  await db.delete(notificationStates).where(eq(notificationStates.tenantId, org.tenantId));
  await org.remove();
});

describe("review items", () => {
  it("lists an unclear category, a flagged asset, an unconfirmed concession and an intangible without its period, and clears them as they are settled", async () => {
    const [pc] = await db.insert(assets).values({ tenantId: org.tenantId, assetCode: "PC-1", name: "Laptop", categoryId: catId["Computer & IT Equipment"], status: "active", source: "purchase", purchaseDate: "2025-09-01", availableForUseDate: "2025-09-01", capitalizedCost: "50000", depreciationMethod: "none" }).returning({ id: assets.id });
    const [sw] = await db.insert(assets).values({ tenantId: org.tenantId, assetCode: "SW-1", name: "Licence", categoryId: catId["Intangible Assets"], status: "active", source: "purchase", purchaseDate: "2025-09-01", availableForUseDate: "2025-09-01", capitalizedCost: "30000", depreciationMethod: "none" }).returning({ id: assets.id });
    expect(await saveAssetTaxProfile(org.tenantId, org.userId, { assetId: pc.id, poolKeyOverride: null, enteredClassDate: null, costIncurredDate: null, periodOfUseYears: null, periodBasis: "", concessionKey: "fiscal_printer_full", concessionConfirmed: false, concessionDocumentation: "", needsReview: true, reviewNote: "Is this a printer?", taxYear: Y })).toEqual({ ok: true });

    const items = await reviewItems(org.tenantId, Y);
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["asset", "category", "concession", "period"]);
    expect(items.find((i) => i.kind === "category")!.title).toMatch(/Other Fixed Assets/);
    expect(items.find((i) => i.kind === "period")!.title).toMatch(/SW-1/);

    // settle them
    const cats = await db.select().from(assetCategories).where(eq(assetCategories.id, catId["Other Fixed Assets"]));
    expect(await setCategoryClass(org.tenantId, org.userId, { categoryId: cats[0].id, poolKey: "D", taxYear: Y })).toEqual({ ok: true });
    expect(await saveAssetTaxProfile(org.tenantId, org.userId, { assetId: pc.id, poolKeyOverride: null, enteredClassDate: null, costIncurredDate: null, periodOfUseYears: null, periodBasis: "", concessionKey: null, concessionConfirmed: false, concessionDocumentation: "", needsReview: false, reviewNote: "", taxYear: Y })).toEqual({ ok: true });
    expect(await saveAssetTaxProfile(org.tenantId, org.userId, { assetId: sw.id, poolKeyOverride: null, enteredClassDate: null, costIncurredDate: null, periodOfUseYears: 5, periodBasis: "Licence term", concessionKey: null, concessionConfirmed: false, concessionDocumentation: "", needsReview: false, reviewNote: "", taxYear: Y })).toEqual({ ok: true });
    expect(await reviewItems(org.tenantId, Y)).toEqual([]);
  });
});

describe("the books beside the tax figures", () => {
  it("adds book depreciation and gain on disposal in the tax year and sets them against the tax result", async () => {
    await saveOpeningPool(org.tenantId, org.userId, { taxYear: Y, poolKey: "B", assetId: null, openingWdv: 100000, note: "" });
    const [run] = await db.insert(assetDepreciationRuns).values({ tenantId: org.tenantId, runNumber: 1, periodStart: "2025-10-01", periodEnd: "2025-10-31", periodLabel: "Kartik", totalAmount: "1200", assetCount: 1, status: "posted" }).returning({ id: assetDepreciationRuns.id });
    const [pc] = await db.select({ id: assets.id }).from(assets).where(eq(assets.assetCode, "PC-1"));
    await db.insert(assetDepreciationLines).values({ runId: run.id, tenantId: org.tenantId, assetId: pc.id, months: 1, amount: "1200", accumulatedAfter: "1200" });
    // a run outside the tax year must not count
    const [other] = await db.insert(assetDepreciationRuns).values({ tenantId: org.tenantId, runNumber: 2, periodStart: "2024-10-01", periodEnd: "2024-10-31", periodLabel: "Kartik", totalAmount: "999", assetCount: 1, status: "posted" }).returning({ id: assetDepreciationRuns.id });
    await db.insert(assetDepreciationLines).values({ runId: other.id, tenantId: org.tenantId, assetId: pc.id, months: 1, amount: "999", accumulatedAfter: "999" });
    await db.insert(assetDisposals).values({ tenantId: org.tenantId, assetId: pc.id, kind: "sale", reference: "DSP-R1", disposalDate: "2026-02-01", saleAmount: "10000", total: "10000", cost: "50000", accumulatedDepreciation: "40000", netBookValue: "10000", gainLoss: "2500", status: "posted" });

    const r = await previewTaxYear(org.tenantId, Y);
    if (!r.ok) throw new Error(r.error);
    const c = await booksVsTax(org.tenantId, r.preview);
    expect(c.bookDepreciation).toBe(1200);
    expect(c.bookDisposalGainLoss).toBe(2500);
    expect(c.taxDeduction).toBe(r.preview.totals.totalDeduction);
    expect(c.depreciationDifference).toBe(Math.round((c.taxDeduction - 1200) * 100) / 100);
  });
});

describe("the bell", () => {
  it("knows the current tax year, and shows review items to someone who can see assets", async () => {
    expect(await currentTaxYearFor(org.tenantId, "2026-03-01")).toBe(Y);
    await saveAssetTaxProfile(org.tenantId, org.userId, { assetId: (await db.select({ id: assets.id }).from(assets).where(eq(assets.assetCode, "PC-1")))[0].id, poolKeyOverride: null, enteredClassDate: null, costIncurredDate: null, periodOfUseYears: null, periodBasis: "", concessionKey: null, concessionConfirmed: false, concessionDocumentation: "", needsReview: true, reviewNote: "Check", taxYear: Y });
    const all = await loadNotifications(org.tenantId, "2026-03-01", () => true);
    expect(all.find((n) => n.key === "tax_depreciation_review")).toMatchObject({ group: "verify", count: 1, href: "/assets/tax-depreciation" });
    const none = await loadNotifications(org.tenantId, "2026-03-01", (k) => k !== "tax_depreciation_review");
    expect(none.some((n) => n.key === "tax_depreciation_review")).toBe(false);
  });
});
