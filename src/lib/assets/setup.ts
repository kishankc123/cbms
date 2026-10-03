import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetSettings } from "@/db/schema";
import { ensureAssetAccounts } from "./accounts";

type Method = "straight_line" | "declining_balance" | "none";

// Starting categories. Everything here is only a default for a new asset and can be edited or switched off in Setup.
export const DEFAULT_ASSET_CATEGORIES: { name: string; method: Method; lifeYears: number | null; residualPercent: number }[] = [
  { name: "Land", method: "none", lifeYears: null, residualPercent: 0 },
  { name: "Building", method: "straight_line", lifeYears: 30, residualPercent: 0 },
  { name: "Computer & IT Equipment", method: "straight_line", lifeYears: 4, residualPercent: 0 },
  { name: "Furniture & Fixtures", method: "straight_line", lifeYears: 10, residualPercent: 0 },
  { name: "Office Equipment", method: "straight_line", lifeYears: 5, residualPercent: 0 },
  { name: "Vehicle", method: "straight_line", lifeYears: 5, residualPercent: 0 },
  { name: "Machinery", method: "straight_line", lifeYears: 10, residualPercent: 0 },
  { name: "Plant & Equipment", method: "straight_line", lifeYears: 10, residualPercent: 0 },
  { name: "Construction Equipment", method: "straight_line", lifeYears: 8, residualPercent: 0 },
  { name: "Intangible Assets", method: "straight_line", lifeYears: 5, residualPercent: 0 },
  { name: "Other Fixed Assets", method: "straight_line", lifeYears: 5, residualPercent: 0 },
];

/**
 * Everything the Assets pages need to exist: the settings row, the starting categories and the six role accounts.
 * Safe to call on every page load — it only writes what is missing.
 */
export async function ensureAssetSetup(tenantId: string) {
  let [settings] = await db.select().from(assetSettings).where(eq(assetSettings.tenantId, tenantId)).limit(1);
  if (!settings) {
    [settings] = await db.insert(assetSettings).values({ tenantId }).onConflictDoNothing().returning();
    if (!settings) [settings] = await db.select().from(assetSettings).where(eq(assetSettings.tenantId, tenantId)).limit(1);
  }

  const [anyCategory] = await db.select({ id: assetCategories.id }).from(assetCategories).where(eq(assetCategories.tenantId, tenantId)).limit(1);
  if (!anyCategory) {
    await db
      .insert(assetCategories)
      .values(DEFAULT_ASSET_CATEGORIES.map((c, i) => ({ tenantId, name: c.name, defaultMethod: c.method, defaultUsefulLifeYears: c.lifeYears, defaultResidualPercent: String(c.residualPercent), sortOrder: i })))
      .onConflictDoNothing();
  }

  const accounts = await ensureAssetAccounts(tenantId);
  return { settings, accounts };
}

export async function listAssetCategories(tenantId: string) {
  return db.select().from(assetCategories).where(eq(assetCategories.tenantId, tenantId)).orderBy(asc(assetCategories.sortOrder), asc(assetCategories.name));
}
