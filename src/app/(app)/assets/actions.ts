"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetLocations, vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getFiscalRange } from "@/lib/fiscal";
import { assetSummary, getAsset, listAssetAudit, listAssetEvents, listAssets, updateAssetDetails, type UpdateAssetInput, type UpdateAssetResult } from "@/lib/assets/register";
import { depreciableAmount, depreciationSchedule } from "@/lib/assets/depreciation";
import { ensureAssetSetup, listAssetCategories } from "@/lib/assets/setup";
import { nextAssetCode } from "@/lib/assets/next-code";
import { recordAssetPurchase, voidAssetPurchase, type AssetPurchaseInput, type AssetPurchaseResult } from "@/lib/assets/purchase";
import { getSupplierBalances } from "@/lib/ledger/supplier-balances";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { inputVatClaimable } from "@/lib/purchases/vat";

export async function getAssetListData(params: { search?: string; status?: string; categoryId?: string; page?: number; pageSize?: number }) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  await ensureAssetSetup(session.tenantId);

  const pageSize = [25, 50, 100].includes(params.pageSize ?? 0) ? params.pageSize! : 25;
  const fiscal = await getFiscalRange(session.tenantId);
  const [summary, list, categories] = await Promise.all([
    assetSummary(session.tenantId, fiscal),
    listAssets(session.tenantId, { search: params.search, status: params.status, categoryId: params.categoryId, page: params.page ?? 1, pageSize }),
    db.select({ id: assetCategories.id, name: assetCategories.name }).from(assetCategories).where(eq(assetCategories.tenantId, session.tenantId)).orderBy(asc(assetCategories.sortOrder), asc(assetCategories.name)),
  ]);
  return { summary, list, categories, canCreate: can(session, "assets", "create") };
}

const SCHEDULE_LIMIT = 600;

export async function getAssetDetailData(assetId: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");

  const found = await getAsset(session.tenantId, assetId);
  if (!found) return null;
  const a = found.asset;

  const cost = Number(a.capitalizedCost);
  const accumulated = Number(a.accumulatedDepreciation);
  const opening = Number(a.openingAccumulatedDepreciation);
  const residual = Number(a.residualValue);
  const startDate = a.depreciationStartDate ?? a.availableForUseDate ?? a.purchaseDate;

  // What is still to come: the schedule from the start date, over the months not yet depreciated, from today's position.
  const schedule =
    startDate && a.usefulLifeMonths
      ? depreciationSchedule({ cost, residual, accumulatedBefore: opening, method: a.depreciationMethod, months: a.usefulLifeMonths, startDate, calendar: session.calendar }).slice(0, SCHEDULE_LIMIT)
      : [];

  const [events, audit, categories, locations] = await Promise.all([
    listAssetEvents(session.tenantId, a.id),
    listAssetAudit(session.tenantId, a.id),
    db.select({ id: assetCategories.id, name: assetCategories.name, isActive: assetCategories.isActive }).from(assetCategories).where(eq(assetCategories.tenantId, session.tenantId)).orderBy(asc(assetCategories.sortOrder), asc(assetCategories.name)),
    db.select({ id: assetLocations.id, name: assetLocations.name, isActive: assetLocations.isActive }).from(assetLocations).where(and(eq(assetLocations.tenantId, session.tenantId))).orderBy(asc(assetLocations.name)),
  ]);

  return {
    canEdit: can(session, "assets", "edit"),
    canVoid: can(session, "assets", "delete"),
    asset: {
      id: a.id,
      assetCode: a.assetCode,
      name: a.name,
      description: a.description ?? "",
      status: a.status,
      source: a.source,
      categoryId: a.categoryId,
      categoryName: found.categoryName,
      locationId: a.locationId,
      locationName: found.locationName,
      purchaseDate: a.purchaseDate,
      availableForUseDate: a.availableForUseDate,
      supplierName: found.vendorName,
      supplierPan: found.vendorPan,
      invoiceNumber: a.invoiceNumber,
      purchaseOrderNumber: a.purchaseOrderNumber,
      purchaseReference: a.purchaseReference,
      supportingDocument: a.supportingDocument,
      purchasePrice: Number(a.purchasePrice),
      vatAmount: Number(a.vatAmount),
      freightCost: Number(a.freightCost),
      installationCost: Number(a.installationCost),
      otherCost: Number(a.otherCost),
      capitalizedCost: cost,
      accumulatedDepreciation: accumulated,
      openingAccumulatedDepreciation: opening,
      netBookValue: Math.round((cost - accumulated) * 100) / 100,
      depreciationMethod: a.depreciationMethod,
      usefulLifeMonths: a.usefulLifeMonths,
      residualValue: residual,
      depreciationStartDate: a.depreciationStartDate,
      lastDepreciationDate: a.lastDepreciationDate,
      remainingDepreciable: depreciableAmount(cost, residual, accumulated),
    },
    schedule,
    events: events.map((e) => ({ id: e.id, eventType: e.eventType, eventDate: e.eventDate, description: e.description, amount: e.amount === null ? null : Number(e.amount) })),
    audit: audit.map((e) => ({ id: e.id, action: e.action, at: e.at.toISOString(), userName: e.userName, before: e.before, after: e.after })),
    categories,
    locations,
  };
}
export type AssetDetailData = NonNullable<Awaited<ReturnType<typeof getAssetDetailData>>>;

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<UpdateAssetResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false, error: "You don't have permission to edit assets." };
  const result = await updateAssetDetails(session.tenantId, session.userId, assetId, input);
  if (result.ok) {
    revalidatePath("/assets", "layout");
  }
  return result;
}

// ---------------------------------------------------------------- purchase

export async function getAssetPurchaseFormData() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  const { settings } = await ensureAssetSetup(session.tenantId);

  const [categories, locations, vendorList, vendorBalances, cashBankAccounts, vatRate, vatClaimable, nextCode] = await Promise.all([
    listAssetCategories(session.tenantId),
    db.select({ id: assetLocations.id, name: assetLocations.name }).from(assetLocations).where(and(eq(assetLocations.tenantId, session.tenantId), eq(assetLocations.isActive, true))).orderBy(asc(assetLocations.name)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    getSupplierBalances(session.tenantId),
    getCashBankAccounts(session.tenantId),
    getCurrentTaxRate(session.tenantId, "vat"),
    inputVatClaimable(session.tenantId),
    nextAssetCode(session.tenantId),
  ]);

  return {
    canCreate: can(session, "assets", "create"),
    autoGenerateCode: settings.autoGenerateCode,
    nextCode,
    vatRate,
    vatClaimable,
    categories: categories
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name, method: c.defaultMethod, lifeMonths: c.defaultUsefulLifeYears ? c.defaultUsefulLifeYears * 12 : null, residualPercent: Number(c.defaultResidualPercent) })),
    locations,
    vendors: vendorList,
    vendorBalances,
    cashBankAccounts,
  };
}
export type AssetPurchaseFormData = Awaited<ReturnType<typeof getAssetPurchaseFormData>>;

export async function createAssetPurchase(input: AssetPurchaseInput): Promise<AssetPurchaseResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "create")) return { ok: false, error: "You don't have permission to purchase assets." };
  const result = await recordAssetPurchase(session.tenantId, session.userId, input);
  if (result.ok) for (const p of ["/assets", "/suppliers", "/dashboard", "/journal", "/payments"]) revalidatePath(p, p === "/assets" ? "layout" : "page");
  return result;
}

export async function voidAssetPurchaseAction(assetId: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "delete")) return { ok: false as const, error: "You don't have permission to void asset purchases." };
  const result = await voidAssetPurchase(session.tenantId, session.userId, assetId);
  if (result.ok) for (const p of ["/assets", "/suppliers", "/dashboard", "/journal", "/payments"]) revalidatePath(p, p === "/assets" ? "layout" : "page");
  return result;
}
