import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetEvents, assetLocations, assets, auditLog, users, vendors } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { validateADDate } from "@/lib/calendar";

// Reading and editing the asset register. Everything is scoped to one organization and paginated in the database, so
// the list stays quick however many assets there are; the summary is a single aggregate query.

export const ASSET_STATUSES = ["draft", "active", "fully_depreciated", "disposed", "sold", "written_off", "voided"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
/** Statuses where the asset is still on the books (counts in cost, accumulated depreciation and net book value). */
export const LIVE_STATUSES: AssetStatus[] = ["draft", "active", "fully_depreciated"];
export const RETIRED_STATUSES: AssetStatus[] = ["disposed", "sold", "written_off", "voided"];

export type AssetListFilters = { search?: string; status?: string; categoryId?: string; page: number; pageSize: number };

function listWhere(tenantId: string, f: Pick<AssetListFilters, "search" | "status" | "categoryId">): SQL {
  const conditions: (SQL | undefined)[] = [eq(assets.tenantId, tenantId)];
  const q = f.search?.trim();
  if (q) conditions.push(or(ilike(assets.assetCode, `%${q}%`), ilike(assets.name, `%${q}%`)));
  if (f.status && (ASSET_STATUSES as readonly string[]).includes(f.status)) conditions.push(eq(assets.status, f.status as AssetStatus));
  if (f.categoryId) conditions.push(eq(assets.categoryId, f.categoryId));
  return and(...conditions) as SQL;
}

export async function listAssets(tenantId: string, filters: AssetListFilters) {
  const where = listWhere(tenantId, filters);
  const pageSize = Math.min(Math.max(filters.pageSize, 1), 200);
  const page = Math.max(filters.page, 1);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: assets.id,
        assetCode: assets.assetCode,
        name: assets.name,
        status: assets.status,
        source: assets.source,
        purchaseDate: assets.purchaseDate,
        cost: assets.capitalizedCost,
        accumulated: assets.accumulatedDepreciation,
        categoryName: assetCategories.name,
        locationName: assetLocations.name,
      })
      .from(assets)
      .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .leftJoin(assetLocations, eq(assetLocations.id, assets.locationId))
      .where(where)
      .orderBy(asc(assets.assetCode))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(assets).where(where),
  ]);

  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({ ...r, cost: Number(r.cost), accumulated: Number(r.accumulated), netBookValue: Math.round((Number(r.cost) - Number(r.accumulated)) * 100) / 100 })),
  };
}

export async function assetSummary(tenantId: string, fiscal: { from: string; to: string }) {
  const live = sql`${assets.status} in ('draft', 'active', 'fully_depreciated')`;
  const [row] = await db
    .select({
      cost: sql<string>`coalesce(sum(${assets.capitalizedCost}) filter (where ${live}), 0)`,
      accumulated: sql<string>`coalesce(sum(${assets.accumulatedDepreciation}) filter (where ${live}), 0)`,
      additions: sql<string>`coalesce(sum(${assets.capitalizedCost}) filter (where ${assets.source} = 'purchase' and ${assets.purchaseDate} between ${fiscal.from} and ${fiscal.to}), 0)`,
      disposed: sql<number>`(count(*) filter (where ${assets.status} in ('disposed', 'sold', 'written_off')))::int`,
      fullyDepreciated: sql<number>`(count(*) filter (where ${assets.status} = 'fully_depreciated'))::int`,
    })
    .from(assets)
    .where(eq(assets.tenantId, tenantId));

  const cost = Number(row.cost);
  const accumulated = Number(row.accumulated);
  return { cost, accumulated, netBookValue: Math.round((cost - accumulated) * 100) / 100, additions: Number(row.additions), disposed: row.disposed, fullyDepreciated: row.fullyDepreciated };
}

export async function getAsset(tenantId: string, id: string) {
  const [row] = await db
    .select({
      asset: assets,
      categoryName: assetCategories.name,
      locationName: assetLocations.name,
      vendorName: vendors.name,
      vendorPan: vendors.panNumber,
    })
    .from(assets)
    .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
    .leftJoin(assetLocations, eq(assetLocations.id, assets.locationId))
    .leftJoin(vendors, eq(vendors.id, assets.vendorId))
    .where(and(eq(assets.id, id), eq(assets.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

export async function listAssetEvents(tenantId: string, assetId: string) {
  return db
    .select({ id: assetEvents.id, eventType: assetEvents.eventType, eventDate: assetEvents.eventDate, description: assetEvents.description, amount: assetEvents.amount, journalEntryId: assetEvents.journalEntryId })
    .from(assetEvents)
    .where(and(eq(assetEvents.tenantId, tenantId), eq(assetEvents.assetId, assetId)))
    .orderBy(asc(assetEvents.eventDate), asc(assetEvents.createdAt));
}

/** Every recorded change to this asset (who, when, before and after). */
export async function listAssetAudit(tenantId: string, assetId: string) {
  return db
    .select({ id: auditLog.id, action: auditLog.action, at: auditLog.timestamp, before: auditLog.beforeValue, after: auditLog.afterValue, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityType, "asset"), eq(auditLog.entityId, assetId)))
    .orderBy(desc(auditLog.timestamp));
}

export type UpdateAssetInput = {
  name: string;
  description: string;
  categoryId: string;
  locationId: string | null;
  /** Depreciation settings: only accepted until the first depreciation has been posted. */
  depreciation?: { method: "straight_line" | "declining_balance" | "none"; usefulLifeMonths: number | null; residualValue: number; startDate: string | null };
};
export type UpdateAssetResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): UpdateAssetResult => ({ ok: false, error });

/**
 * Edits an asset's descriptive details, and its depreciation settings while no depreciation has been posted yet. Cost
 * is not editable here: it comes from the purchase or the opening entry, which post to the ledger.
 */
export async function updateAssetDetails(tenantId: string, userId: string, id: string, input: UpdateAssetInput): Promise<UpdateAssetResult> {
  const found = await getAsset(tenantId, id);
  if (!found) return fail("Asset not found.");
  const a = found.asset;

  const name = input.name.trim();
  if (!name) return fail("Enter the asset name.");

  const [category] = await db.select().from(assetCategories).where(and(eq(assetCategories.id, input.categoryId), eq(assetCategories.tenantId, tenantId))).limit(1);
  if (!category) return fail("Choose an asset category.");
  if (!category.isActive && category.id !== a.categoryId) return fail(`The category "${category.name}" is inactive; choose an active one.`);

  if (input.locationId) {
    const [location] = await db.select().from(assetLocations).where(and(eq(assetLocations.id, input.locationId), eq(assetLocations.tenantId, tenantId))).limit(1);
    if (!location) return fail("Choose a valid location.");
    if (!location.isActive && location.id !== a.locationId) return fail(`The location "${location.name}" is inactive; choose an active one.`);
  }

  const patch: Partial<typeof assets.$inferInsert> = { name, description: input.description.trim() || null, categoryId: input.categoryId, locationId: input.locationId || null, updatedAt: new Date() };

  const retired = (RETIRED_STATUSES as string[]).includes(a.status);
  if (input.depreciation) {
    const d = input.depreciation;
    if (retired) return fail("A disposed or written-off asset's depreciation can't be changed.");
    if (a.lastDepreciationDate) return fail("Depreciation has already been posted for this asset, so its depreciation settings can't be changed.");
    if (!["straight_line", "declining_balance", "none"].includes(d.method)) return fail("Choose a depreciation method.");
    const depreciated = d.method !== "none";
    if (depreciated && !(Number.isInteger(d.usefulLifeMonths) && d.usefulLifeMonths! >= 1 && d.usefulLifeMonths! <= 1200)) return fail("Enter the useful life in whole months (1–1200).");
    if (!(d.residualValue >= 0)) return fail("The residual value can't be negative.");
    if (d.residualValue > Number(a.capitalizedCost) - Number(a.openingAccumulatedDepreciation)) return fail("The residual value can't be more than the asset's remaining value.");
    if (depreciated && (!d.startDate || !validateADDate(d.startDate))) return fail("Enter a valid depreciation start date.");
    Object.assign(patch, { depreciationMethod: d.method, usefulLifeMonths: depreciated ? d.usefulLifeMonths : null, residualValue: d.residualValue.toFixed(2), depreciationStartDate: depreciated ? d.startDate : null });
  }

  await db.update(assets).set(patch).where(eq(assets.id, a.id));
  await logAuditEvent({
    tenantId,
    userId,
    action: "asset_changed",
    entityType: "asset",
    entityId: a.id,
    before: { name: a.name, description: a.description, categoryId: a.categoryId, locationId: a.locationId, method: a.depreciationMethod, usefulLifeMonths: a.usefulLifeMonths, residualValue: a.residualValue, startDate: a.depreciationStartDate },
    after: { name, description: patch.description, categoryId: patch.categoryId, locationId: patch.locationId, method: patch.depreciationMethod ?? a.depreciationMethod, usefulLifeMonths: patch.usefulLifeMonths ?? a.usefulLifeMonths, residualValue: patch.residualValue ?? a.residualValue, startDate: patch.depreciationStartDate ?? a.depreciationStartDate },
  });
  return { ok: true };
}
