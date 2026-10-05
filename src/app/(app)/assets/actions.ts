"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetLocations, assets, customers, vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getFiscalRange } from "@/lib/fiscal";
import { assetSummary, getAsset, listAssetAudit, listAssetEvents, listAssets, updateAssetDetails, type UpdateAssetInput, type UpdateAssetResult } from "@/lib/assets/register";
import { depreciableAmount, depreciationSchedule } from "@/lib/assets/depreciation";
import { ensureAssetSetup, listAssetCategories } from "@/lib/assets/setup";
import { nextAssetCode } from "@/lib/assets/next-code";
import { recordAssetPurchase, voidAssetPurchase, type AssetPurchaseInput, type AssetPurchaseResult } from "@/lib/assets/purchase";
import { assetLedgerReconciliation, listOpeningAssets, recordOpeningAsset, updateOpeningAsset, voidOpeningAsset, type OpeningAssetInput, type OpeningAssetResult } from "@/lib/assets/opening";
import { openingBalanceEntryDate } from "@/lib/ledger/opening-balance";
import { depreciationSummary, listRuns, postDepreciationRun, previewRun, reverseDepreciationRun, runnableMonths } from "@/lib/assets/run";
import { disposeAsset, listDisposals, reverseAssetDisposal, type AssetDisposalInput } from "@/lib/assets/disposal";
import { salesVatRate } from "@/lib/sales/vat";
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
      originalUsefulLifeMonths: a.originalUsefulLifeMonths,
      remainingDepreciable: depreciableAmount(cost, residual, accumulated),
    },
    schedule: schedule.map((r) => ({ ...r, posted: !!a.lastDepreciationDate && r.periodEnd <= a.lastDepreciationDate })),
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

// ---------------------------------------------------------------- opening assets

export async function getOpeningAssetsData() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  const { settings } = await ensureAssetSetup(session.tenantId);

  const [categories, locations, list, rows, reconciliation, openingDate, nextCode] = await Promise.all([
    listAssetCategories(session.tenantId),
    db.select({ id: assetLocations.id, name: assetLocations.name }).from(assetLocations).where(and(eq(assetLocations.tenantId, session.tenantId), eq(assetLocations.isActive, true))).orderBy(asc(assetLocations.name)),
    listOpeningAssets(session.tenantId),
    db.select().from(assets).where(and(eq(assets.tenantId, session.tenantId), eq(assets.source, "opening"))),
    assetLedgerReconciliation(session.tenantId),
    openingBalanceEntryDate(session.tenantId),
    nextAssetCode(session.tenantId),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    canCreate: can(session, "assets", "create"),
    canEdit: can(session, "assets", "edit"),
    canVoid: can(session, "assets", "delete"),
    autoGenerateCode: settings.autoGenerateCode,
    nextCode,
    openingDate,
    reconciliation,
    categories: categories
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name, method: c.defaultMethod, lifeMonths: c.defaultUsefulLifeYears ? c.defaultUsefulLifeYears * 12 : null, residualPercent: Number(c.defaultResidualPercent) })),
    locations,
    assets: list.map((r) => {
      const full = byId.get(r.id)!;
      const retired = r.status === "voided";
      return {
        ...r,
        // What the edit form starts from.
        form: {
          name: full.name,
          description: full.description ?? "",
          categoryId: full.categoryId,
          locationId: full.locationId ?? "",
          assetCode: full.assetCode,
          originalPurchaseDate: full.purchaseDate ?? "",
          supportingDocument: full.supportingDocument ?? "",
          cost: Number(full.capitalizedCost),
          accumulatedDepreciation: Number(full.openingAccumulatedDepreciation),
          method: full.depreciationMethod,
          originalUsefulLifeMonths: full.originalUsefulLifeMonths,
          remainingUsefulLifeMonths: full.usefulLifeMonths,
          residualValue: Number(full.residualValue),
          depreciationStartDate: full.depreciationStartDate ?? "",
        },
        changeable: !retired && !r.locked && r.status !== "disposed" && r.status !== "sold" && r.status !== "written_off",
      };
    }),
  };
}
export type OpeningAssetsData = Awaited<ReturnType<typeof getOpeningAssetsData>>;

const refreshAfterOpening = () => {
  for (const p of ["/assets", "/dashboard", "/journal"]) revalidatePath(p, p === "/assets" ? "layout" : "page");
};

export async function createOpeningAsset(input: OpeningAssetInput): Promise<OpeningAssetResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "create")) return { ok: false, error: "You don't have permission to add opening assets." };
  const result = await recordOpeningAsset(session.tenantId, session.userId, input);
  if (result.ok) refreshAfterOpening();
  return result;
}

export async function updateOpeningAssetAction(assetId: string, input: OpeningAssetInput): Promise<OpeningAssetResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false, error: "You don't have permission to edit assets." };
  const result = await updateOpeningAsset(session.tenantId, session.userId, assetId, input);
  if (result.ok) refreshAfterOpening();
  return result;
}

export async function voidOpeningAssetAction(assetId: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "delete")) return { ok: false as const, error: "You don't have permission to void opening assets." };
  const result = await voidOpeningAsset(session.tenantId, session.userId, assetId);
  if (result.ok) refreshAfterOpening();
  return result;
}

// ---------------------------------------------------------------- depreciation runs

export async function getDepreciationPageData() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  await ensureAssetSetup(session.tenantId);
  const [months, runs, summary] = await Promise.all([runnableMonths(session.tenantId, session.calendar), listRuns(session.tenantId), depreciationSummary(session.tenantId)]);
  const latestPosted = runs.find((r) => r.status === "posted") ?? null;
  const preview = months[0] ? await previewRun(session.tenantId, session.calendar, months[0].anchor) : null;
  return { canRun: can(session, "assets", "edit"), canReverse: can(session, "assets", "delete"), months, runs, latestPostedId: latestPosted?.id ?? null, lastRunLabel: latestPosted?.periodLabel ?? null, summary, preview };
}
export type DepreciationPageData = Awaited<ReturnType<typeof getDepreciationPageData>>;

export async function previewDepreciation(anchor: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  return previewRun(session.tenantId, session.calendar, anchor);
}

const refreshAfterRun = () => {
  for (const p of ["/assets", "/dashboard", "/journal"]) revalidatePath(p, p === "/assets" ? "layout" : "page");
};

export async function runDepreciation(anchor: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false as const, error: "You don't have permission to run depreciation." };
  const result = await postDepreciationRun(session.tenantId, session.userId, session.calendar, anchor);
  if (result.ok) refreshAfterRun();
  return result;
}

export async function reverseDepreciation(runId: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "delete")) return { ok: false as const, error: "You don't have permission to reverse depreciation." };
  const result = await reverseDepreciationRun(session.tenantId, session.userId, runId);
  if (result.ok) refreshAfterRun();
  return result;
}

// ---------------------------------------------------------------- sale, disposal, write-off

export async function getDisposalFormData() {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  const [eligible, customerList, cashBankAccounts, vatRate, disposals] = await Promise.all([
    db
      .select({ id: assets.id, assetCode: assets.assetCode, name: assets.name, cost: assets.capitalizedCost, accumulated: assets.accumulatedDepreciation })
      .from(assets)
      .where(and(eq(assets.tenantId, session.tenantId), inArray(assets.status, ["active", "fully_depreciated"])))
      .orderBy(asc(assets.assetCode))
      .limit(1000),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
    getCashBankAccounts(session.tenantId),
    salesVatRate(session.tenantId),
    listDisposals(session.tenantId),
  ]);
  return {
    canCreate: can(session, "assets", "edit"),
    canReverse: can(session, "assets", "delete"),
    vatRate,
    assets: eligible.map((e) => ({ id: e.id, assetCode: e.assetCode, name: e.name, cost: Number(e.cost), accumulated: Number(e.accumulated) })),
    customers: customerList,
    cashBankAccounts,
    disposals,
  };
}
export type DisposalFormData = Awaited<ReturnType<typeof getDisposalFormData>>;

const refreshAfterDisposal = () => {
  for (const p of ["/assets", "/dashboard", "/journal", "/compliance"]) revalidatePath(p, p === "/assets" ? "layout" : "page");
};

export async function createAssetDisposal(input: AssetDisposalInput) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false as const, error: "You don't have permission to sell or dispose of assets." };
  const result = await disposeAsset(session.tenantId, session.userId, session.calendar, input);
  if (result.ok) refreshAfterDisposal();
  return result;
}

export async function reverseAssetDisposalAction(disposalId: string) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "delete")) return { ok: false as const, error: "You don't have permission to reverse this." };
  const result = await reverseAssetDisposal(session.tenantId, session.userId, disposalId);
  if (result.ok) refreshAfterDisposal();
  return result;
}
