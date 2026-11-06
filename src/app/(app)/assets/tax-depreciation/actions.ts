"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, assetTaxProfiles, taxStatutoryAdditions } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { taxYearOf, taxYearStarting } from "@/lib/tax-depreciation/dates";
import { NEPAL_TAX_DEPRECIATION_RULES } from "@/lib/tax-depreciation/rules";
import { addOpeningDeferred, addStatutoryAddition, cancelDeferred, ensureTaxCategoryMap, listDeferred, listOpeningPools, rulesForTaxYear, saveOpeningPool, setCategoryClass, type OpeningDeferredInput } from "@/lib/tax-depreciation/setup";

// Tax depreciation set-up for the signed-in organization. Nothing here posts to the ledger.

export type ActionResult = { ok: true } | { ok: false; error: string };
const done = () => revalidatePath("/assets/tax-depreciation");

export async function getTaxDepreciationSetupData(requestedYear?: number) {
  const session = await requireTenantSession();
  if (!can(session, "assets", "view")) throw new Error("Not permitted");
  const today = todayIso();
  const current = taxYearOf(today, NEPAL_TAX_DEPRECIATION_RULES);
  const taxYear = requestedYear ?? current?.startYear ?? 2082;
  const published = await rulesForTaxYear(session.tenantId, taxYear);
  const years = [taxYear - 1, taxYear, taxYear + 1].map((y) => ({ startYear: y, label: taxYearStarting(y, NEPAL_TAX_DEPRECIATION_RULES)?.label ?? String(y) }));
  if (!published) return { canEdit: can(session, "assets", "edit"), canVoid: can(session, "assets", "void"), taxYear, years, rules: null, isVerified: false, categories: [], openings: [], individualAssets: [], deferred: [], statutory: [] };

  const [categories, openings, deferred, statutory, intangible] = await Promise.all([
    ensureTaxCategoryMap(session.tenantId),
    listOpeningPools(session.tenantId, taxYear),
    listDeferred(session.tenantId),
    db.select().from(taxStatutoryAdditions).where(and(eq(taxStatutoryAdditions.tenantId, session.tenantId), eq(taxStatutoryAdditions.taxYear, taxYear))).orderBy(asc(taxStatutoryAdditions.createdAt)),
    db.select({ id: assets.id, code: assets.assetCode, name: assets.name, categoryId: assets.categoryId, override: assetTaxProfiles.poolKeyOverride }).from(assets).leftJoin(assetTaxProfiles, eq(assetTaxProfiles.assetId, assets.id)).where(eq(assets.tenantId, session.tenantId)),
  ]);
  const individualKeys = new Set(published.rules.pools.filter((p) => p.kind === "individual").map((p) => p.key));
  const classOfCategory = new Map(categories.map((c) => [c.categoryId, c.poolKey]));
  const individualAssets = intangible.filter((a) => individualKeys.has(a.override ?? classOfCategory.get(a.categoryId) ?? "")).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}`, poolKey: a.override ?? classOfCategory.get(a.categoryId) ?? "" }));
  return {
    canEdit: can(session, "assets", "edit"),
    canVoid: can(session, "assets", "void"),
    taxYear,
    years,
    rules: published.rules,
    isVerified: published.isVerified,
    categories,
    openings: openings.map((o) => ({ id: o.id, poolKey: o.poolKey, assetId: o.assetId, openingWdv: Number(o.openingWdv), note: o.note })),
    individualAssets,
    deferred: deferred.map((d) => ({ id: d.id, assetLabel: d.assetLabel, poolKey: d.poolKey, originalTaxYear: d.originalTaxYear, originalDate: d.originalDate, originalCost: Number(d.originalCost), originalThirds: d.originalThirds, includedInOriginalYear: Number(d.includedInOriginalYear), remainingDeferred: Number(d.remainingDeferred), dueTaxYear: d.dueTaxYear, status: d.status, source: d.source })),
    statutory: statutory.map((s) => ({ id: s.id, poolKey: s.poolKey, typeKey: s.typeKey, description: s.description, amount: Number(s.amount), legalReference: s.legalReference, evidence: s.evidence })),
  };
}
export type TaxDepreciationSetupData = Awaited<ReturnType<typeof getTaxDepreciationSetupData>>;

export async function setTaxCategoryClass(input: { categoryId: string; poolKey: string | null; taxYear: number }): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false, error: "You don't have permission to change tax depreciation settings." };
  const r = await setCategoryClass(session.tenantId, session.userId, input);
  if (r.ok) done();
  return r;
}

export async function saveTaxOpeningPool(input: { taxYear: number; poolKey: string; assetId: string | null; openingWdv: number; note: string }): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false, error: "You don't have permission to change tax depreciation settings." };
  const r = await saveOpeningPool(session.tenantId, session.userId, input);
  if (r.ok) done();
  return r;
}

export async function addTaxOpeningDeferred(input: OpeningDeferredInput): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false, error: "You don't have permission to change tax depreciation settings." };
  const r = await addOpeningDeferred(session.tenantId, session.userId, input);
  if (r.ok) done();
  return r;
}

export async function cancelTaxDeferred(id: string): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "void")) return { ok: false, error: "You don't have permission to cancel a deferred amount." };
  const r = await cancelDeferred(session.tenantId, session.userId, id);
  if (r.ok) done();
  return r;
}

export async function addTaxStatutoryAddition(input: { taxYear: number; poolKey: string; typeKey: string; description: string; amount: number; legalReference: string; evidence: string }): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "assets", "edit")) return { ok: false, error: "You don't have permission to change tax depreciation settings." };
  const r = await addStatutoryAddition(session.tenantId, session.userId, input);
  if (r.ok) done();
  return r;
}
