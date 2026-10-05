import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetLocations, assets, auditLog } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { assetSummary, getAsset, listAssetAudit, listAssets, updateAssetDetails } from "./register";
import { ensureAssetSetup } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
let categoryIds: Record<string, string>;
let locationId: string;
const ids: Record<string, string> = {};

async function add(tenantId: string, over: Partial<typeof assets.$inferInsert> & { assetCode: string; name: string; categoryId: string }) {
  const [row] = await db
    .insert(assets)
    .values({ tenantId, source: "purchase", capitalizedCost: "100000.00", purchaseDate: "2026-08-01", depreciationMethod: "straight_line", usefulLifeMonths: 60, depreciationStartDate: "2026-08-01", ...over })
    .returning();
  return row;
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Assets Register");
  other = await createTempOrg("ZZ Assets Register Other");
  await ensureAssetSetup(org.tenantId);
  await ensureAssetSetup(other.tenantId);
  categoryIds = Object.fromEntries((await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId))).map((c) => [c.name, c.id]));
  [{ id: locationId }] = await db.insert(assetLocations).values({ tenantId: org.tenantId, name: "Head office" }).returning({ id: assetLocations.id });

  ids.laptop = (await add(org.tenantId, { assetCode: "FA-000001", name: "Laptop", categoryId: categoryIds["Computer & IT Equipment"], capitalizedCost: "120000.00", accumulatedDepreciation: "20000.00", locationId })).id;
  ids.van = (await add(org.tenantId, { assetCode: "FA-000002", name: "Delivery van", categoryId: categoryIds["Vehicle"], capitalizedCost: "5000000.00", accumulatedDepreciation: "2000000.00", source: "opening", purchaseDate: "2024-01-01" })).id;
  ids.old = (await add(org.tenantId, { assetCode: "FA-000003", name: "Old printer", categoryId: categoryIds["Office Equipment"], capitalizedCost: "30000.00", accumulatedDepreciation: "30000.00", status: "fully_depreciated" })).id;
  ids.sold = (await add(org.tenantId, { assetCode: "FA-000004", name: "Sold desk", categoryId: categoryIds["Furniture & Fixtures"], capitalizedCost: "50000.00", accumulatedDepreciation: "10000.00", status: "sold" })).id;
  ids.foreign = (await add(other.tenantId, { assetCode: "FA-000001", name: "Other org laptop", categoryId: (await db.select().from(assetCategories).where(eq(assetCategories.tenantId, other.tenantId)))[0].id })).id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("asset register", () => {
  it("lists with search, status and category filters, and pages in the database", async () => {
    const all = await listAssets(org.tenantId, { page: 1, pageSize: 25 });
    expect(all.total).toBe(4);
    expect(all.rows.map((r) => r.assetCode)).toEqual(["FA-000001", "FA-000002", "FA-000003", "FA-000004"]);
    expect(all.rows[0]).toMatchObject({ name: "Laptop", cost: 120000, accumulated: 20000, netBookValue: 100000, locationName: "Head office", categoryName: "Computer & IT Equipment" });

    expect((await listAssets(org.tenantId, { search: "van", page: 1, pageSize: 25 })).rows.map((r) => r.name)).toEqual(["Delivery van"]);
    expect((await listAssets(org.tenantId, { search: "fa-000003", page: 1, pageSize: 25 })).total).toBe(1);
    expect((await listAssets(org.tenantId, { status: "sold", page: 1, pageSize: 25 })).total).toBe(1);
    expect((await listAssets(org.tenantId, { categoryId: categoryIds["Vehicle"], page: 1, pageSize: 25 })).total).toBe(1);

    const page2 = await listAssets(org.tenantId, { page: 2, pageSize: 3 });
    expect(page2.total).toBe(4);
    expect(page2.rows.map((r) => r.assetCode)).toEqual(["FA-000004"]);
  });

  it("never shows another organization's assets", async () => {
    const mine = await listAssets(org.tenantId, { search: "Other org", page: 1, pageSize: 25 });
    expect(mine.total).toBe(0);
    expect(await getAsset(org.tenantId, ids.foreign)).toBeNull();
    expect((await listAssets(other.tenantId, { page: 1, pageSize: 25 })).total).toBe(1);
  });

  it("summarizes only assets still on the books, with this year's additions and the retired count", async () => {
    const s = await assetSummary(org.tenantId, { from: "2026-07-17", to: "2027-07-16" });
    expect(s.cost).toBe(120000 + 5000000 + 30000);
    expect(s.accumulated).toBe(20000 + 2000000 + 30000);
    expect(s.netBookValue).toBe(s.cost - s.accumulated);
    expect(s.additions).toBe(120000 + 30000 + 50000); // every purchase dated in the fiscal year, even one sold since (disposals are counted separately)
    expect(s.disposed).toBe(1);
    expect(s.fullyDepreciated).toBe(1);
  });

  it("edits details, audits the change, and locks depreciation settings once depreciation is posted", async () => {
    const res = await updateAssetDetails(org.tenantId, org.userId, ids.laptop, { name: "Laptop (Dell)", description: "Finance team", categoryId: categoryIds["Computer & IT Equipment"], locationId, depreciation: { method: "straight_line", usefulLifeMonths: 48, residualValue: 5000, startDate: "2026-08-01" } });
    expect(res.ok).toBe(true);
    const row = (await getAsset(org.tenantId, ids.laptop))!.asset;
    expect(row.name).toBe("Laptop (Dell)");
    expect(row.usefulLifeMonths).toBe(48);
    expect(Number(row.residualValue)).toBe(5000);
    const audit = await listAssetAudit(org.tenantId, ids.laptop);
    expect(audit).toHaveLength(1);
    expect((audit[0].before as { name: string }).name).toBe("Laptop");
    expect((audit[0].after as { name: string }).name).toBe("Laptop (Dell)");

    await db.update(assets).set({ lastDepreciationDate: "2026-08-31" }).where(eq(assets.id, ids.laptop));
    const locked = await updateAssetDetails(org.tenantId, org.userId, ids.laptop, { name: "Laptop", description: "", categoryId: categoryIds["Computer & IT Equipment"], locationId: null, depreciation: { method: "none", usefulLifeMonths: null, residualValue: 0, startDate: null } });
    expect(locked).toMatchObject({ ok: false });
    expect((locked as { error: string }).error).toMatch(/already been posted/);
    // the descriptive details can still change without touching depreciation
    expect((await updateAssetDetails(org.tenantId, org.userId, ids.laptop, { name: "Laptop B", description: "", categoryId: categoryIds["Computer & IT Equipment"], locationId: null })).ok).toBe(true);
  });

  it("refuses bad input with a readable message and leaves the asset alone", async () => {
    const base = { description: "", categoryId: categoryIds["Vehicle"], locationId: null };
    const noName = await updateAssetDetails(org.tenantId, org.userId, ids.van, { ...base, name: "  " });
    expect(noName).toMatchObject({ ok: false });
    expect((noName as { error: string }).error).toMatch(/asset name/i);

    const foreignCategory = await updateAssetDetails(org.tenantId, org.userId, ids.van, { ...base, name: "Van", categoryId: (await db.select().from(assetCategories).where(eq(assetCategories.tenantId, other.tenantId)))[0].id });
    expect(foreignCategory).toMatchObject({ ok: false });

    const retired = await updateAssetDetails(org.tenantId, org.userId, ids.sold, { name: "Sold desk", description: "", categoryId: categoryIds["Furniture & Fixtures"], locationId: null, depreciation: { method: "straight_line", usefulLifeMonths: 12, residualValue: 0, startDate: "2026-08-01" } });
    expect((retired as { error: string }).error).toMatch(/disposed or written-off/i);

    expect((await getAsset(org.tenantId, ids.van))!.asset.name).toBe("Delivery van");
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, ids.van))).length).toBe(0);
  });
});
