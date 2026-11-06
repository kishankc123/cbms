import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assets, assetTaxProfiles, taxCategoryMap, taxDeferredAdditions, taxPoolOpenings, taxStatutoryAdditions, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { convertBStoAD } from "@/lib/calendar";
import { defaultNepalClass } from "./classification";
import { taxDepreciationRulesOn } from "./platform-rules";
import type { TaxDepreciationRules } from "./rules";

// Setting up tax depreciation for an organization: which class each category belongs to, the balances brought forward, the deferred additions
// brought forward and statutory additions. Rule problems are returned in plain words; nothing here posts to the ledger.

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());

/** The rules in force during a tax year (identified by its starting Bikram Sambat year) for an organization's country. */
export async function rulesForTaxYear(tenantId: string, taxYear: number): Promise<{ id: string; rules: TaxDepreciationRules; isVerified: boolean } | null> {
  const [t] = await db.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const mid = convertBStoAD({ year: taxYear, month: 4, day: 1 });
  if (!t || !mid) return null;
  return taxDepreciationRulesOn(t.country, mid);
}

/** Gives every category a class the first time tax depreciation is opened, from the names; existing choices are kept. */
export async function ensureTaxCategoryMap(tenantId: string) {
  const [cats, existing] = await Promise.all([
    db.select().from(assetCategories).where(eq(assetCategories.tenantId, tenantId)).orderBy(asc(assetCategories.sortOrder), asc(assetCategories.name)),
    db.select().from(taxCategoryMap).where(eq(taxCategoryMap.tenantId, tenantId)),
  ]);
  const have = new Set(existing.map((e) => e.categoryId));
  const missing = cats.filter((c) => !have.has(c.id));
  if (missing.length) {
    await db.insert(taxCategoryMap).values(missing.map((c) => { const d = defaultNepalClass(c.name); return { tenantId, categoryId: c.id, poolKey: d.poolKey, needsReview: d.needsReview }; })).onConflictDoNothing();
  }
  const rows = await db.select().from(taxCategoryMap).where(eq(taxCategoryMap.tenantId, tenantId));
  const byCat = new Map(rows.map((r) => [r.categoryId, r]));
  return cats.map((c) => ({ categoryId: c.id, name: c.name, isActive: c.isActive, poolKey: byCat.get(c.id)?.poolKey ?? null, needsReview: byCat.get(c.id)?.needsReview ?? false, reason: defaultNepalClass(c.name).reason }));
}

export async function setCategoryClass(tenantId: string, userId: string, input: { categoryId: string; poolKey: string | null; taxYear: number }): Promise<Result> {
  const published = await rulesForTaxYear(tenantId, input.taxYear);
  if (!published) return fail("No tax depreciation rules are published for your country yet.");
  if (input.poolKey !== null && !published.rules.pools.some((p) => p.key === input.poolKey)) return fail("Choose one of the classes in the rules.");
  const [cat] = await db.select({ id: assetCategories.id }).from(assetCategories).where(and(eq(assetCategories.id, input.categoryId), eq(assetCategories.tenantId, tenantId))).limit(1);
  if (!cat) return fail("That category was not found.");
  await ensureTaxCategoryMap(tenantId);
  const [before] = await db.select().from(taxCategoryMap).where(and(eq(taxCategoryMap.tenantId, tenantId), eq(taxCategoryMap.categoryId, input.categoryId))).limit(1);
  await db.update(taxCategoryMap).set({ poolKey: input.poolKey, needsReview: false, reviewedBy: userId, updatedAt: new Date() }).where(and(eq(taxCategoryMap.tenantId, tenantId), eq(taxCategoryMap.categoryId, input.categoryId)));
  await logAuditEvent({ tenantId, userId, action: "tax_category_class_set", entityType: "tax_category_map", entityId: input.categoryId, before: { poolKey: before?.poolKey ?? null }, after: { poolKey: input.poolKey } });
  return { ok: true };
}

/** Records the balance brought forward into a tax year for one class (or one intangible asset). Editing replaces it, and is audit-logged. */
export async function saveOpeningPool(tenantId: string, userId: string, input: { taxYear: number; poolKey: string; assetId: string | null; openingWdv: number; note: string }): Promise<Result> {
  const published = await rulesForTaxYear(tenantId, input.taxYear);
  if (!published) return fail("No tax depreciation rules are published for your country yet.");
  const pool = published.rules.pools.find((p) => p.key === input.poolKey);
  if (!pool) return fail("Choose one of the classes in the rules.");
  if (!(input.openingWdv >= 0)) return fail("The balance brought forward can't be negative.");
  if (pool.kind === "individual" && !input.assetId) return fail("Choose the intangible asset this balance belongs to: each one is its own class.");
  if (pool.kind === "pooled" && input.assetId) return fail("A pooled class has one balance for all its assets, not one per asset.");
  if (input.assetId) {
    const [a] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, input.assetId), eq(assets.tenantId, tenantId))).limit(1);
    if (!a) return fail("That asset was not found.");
  }
  const where = and(eq(taxPoolOpenings.tenantId, tenantId), eq(taxPoolOpenings.taxYear, input.taxYear), eq(taxPoolOpenings.poolKey, input.poolKey), input.assetId ? eq(taxPoolOpenings.assetId, input.assetId) : isNull(taxPoolOpenings.assetId));
  const [before] = await db.select().from(taxPoolOpenings).where(where).limit(1);
  const values = { openingWdv: money(input.openingWdv).toFixed(2), note: input.note.trim() || null, updatedBy: userId, updatedAt: new Date() };
  if (before) await db.update(taxPoolOpenings).set(values).where(and(eq(taxPoolOpenings.id, before.id), eq(taxPoolOpenings.tenantId, tenantId)));
  else await db.insert(taxPoolOpenings).values({ tenantId, taxYear: input.taxYear, poolKey: input.poolKey, assetId: input.assetId, ...values });
  await logAuditEvent({ tenantId, userId, action: "tax_pool_opening_saved", entityType: "tax_pool_openings", entityId: before?.id ?? input.poolKey, before: before ? { openingWdv: before.openingWdv } : null, after: { taxYear: input.taxYear, poolKey: input.poolKey, assetId: input.assetId, openingWdv: money(input.openingWdv) } });
  return { ok: true };
}

export async function listOpeningPools(tenantId: string, taxYear: number) {
  return db.select().from(taxPoolOpenings).where(and(eq(taxPoolOpenings.tenantId, tenantId), eq(taxPoolOpenings.taxYear, taxYear)));
}

export type OpeningDeferredInput = {
  assetId: string | null;
  assetLabel: string;
  poolKey: string;
  originalTaxYear: number;
  originalDate: string;
  originalCost: number;
  originalThirds: 1 | 2 | 3;
  includedInOriginalYear: number;
  remainingDeferred: number;
  dueTaxYear: number;
  note: string;
};

/** Adds a deferred amount brought forward from an earlier year. The same asset's addition on the same date can be entered only once. */
export async function addOpeningDeferred(tenantId: string, userId: string, input: OpeningDeferredInput): Promise<Result> {
  const published = await rulesForTaxYear(tenantId, input.dueTaxYear);
  if (!published) return fail("No tax depreciation rules are published for your country yet.");
  if (!published.rules.pools.some((p) => p.key === input.poolKey)) return fail("Choose one of the classes in the rules.");
  if (!input.assetLabel.trim()) return fail("Say which asset this deferred amount is from.");
  if (!isDate(input.originalDate)) return fail("Enter the date the asset was acquired.");
  if (!(input.originalCost > 0)) return fail("Enter the original cost.");
  if (!(input.remainingDeferred > 0)) return fail("Enter the deferred amount still to be included.");
  if (input.includedInOriginalYear < 0) return fail("The amount already included can't be negative.");
  if (money(input.includedInOriginalYear + input.remainingDeferred) > money(input.originalCost)) return fail("The amount already included plus the deferred amount is more than the original cost.");
  if (!(input.dueTaxYear > input.originalTaxYear)) return fail("A deferred amount is included in a later year than the one it came from.");
  if (input.assetId) {
    const [a] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, input.assetId), eq(assets.tenantId, tenantId))).limit(1);
    if (!a) return fail("That asset was not found.");
    const [dup] = await db.select({ id: taxDeferredAdditions.id }).from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, tenantId), eq(taxDeferredAdditions.assetId, input.assetId), eq(taxDeferredAdditions.originalTaxYear, input.originalTaxYear), eq(taxDeferredAdditions.originalDate, input.originalDate), ne(taxDeferredAdditions.status, "cancelled"))).limit(1);
    if (dup) return fail("This asset's deferred amount for that year is already in the register. Cancel the old entry first if it was wrong.");
  }
  const [row] = await db.insert(taxDeferredAdditions).values({
    tenantId, assetId: input.assetId, assetLabel: input.assetLabel.trim(), poolKey: input.poolKey, originalTaxYear: input.originalTaxYear, originalDate: input.originalDate,
    originalCost: money(input.originalCost).toFixed(2), originalThirds: input.originalThirds, includedInOriginalYear: money(input.includedInOriginalYear).toFixed(2),
    remainingDeferred: money(input.remainingDeferred).toFixed(2), dueTaxYear: input.dueTaxYear, status: "pending", source: "opening", note: input.note.trim() || null, createdBy: userId,
  }).returning({ id: taxDeferredAdditions.id });
  await logAuditEvent({ tenantId, userId, action: "tax_deferred_added", entityType: "tax_deferred_additions", entityId: row.id, before: null, after: { ...input } });
  return { ok: true };
}

/** Cancels an entry that was wrong. An entry already included in a year can't be cancelled: that would change a calculated year. */
export async function cancelDeferred(tenantId: string, userId: string, id: string): Promise<Result> {
  const [row] = await db.select().from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.id, id), eq(taxDeferredAdditions.tenantId, tenantId))).limit(1);
  if (!row) return fail("That entry was not found.");
  if (row.status !== "pending") return fail("Only an entry still waiting to be included can be cancelled.");
  await db.update(taxDeferredAdditions).set({ status: "cancelled" }).where(and(eq(taxDeferredAdditions.id, id), eq(taxDeferredAdditions.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "tax_deferred_cancelled", entityType: "tax_deferred_additions", entityId: id, before: { status: row.status, remainingDeferred: row.remainingDeferred }, after: { status: "cancelled" } });
  return { ok: true };
}

export async function listDeferred(tenantId: string) {
  return db.select().from(taxDeferredAdditions).where(eq(taxDeferredAdditions.tenantId, tenantId)).orderBy(asc(taxDeferredAdditions.dueTaxYear), asc(taxDeferredAdditions.originalDate));
}

/** A statutory addition to a class for a year. A legal reference and supporting evidence are required: no undocumented adjustments. */
export async function addStatutoryAddition(tenantId: string, userId: string, input: { taxYear: number; poolKey: string; typeKey: string; description: string; amount: number; legalReference: string; evidence: string }): Promise<Result> {
  const published = await rulesForTaxYear(tenantId, input.taxYear);
  if (!published) return fail("No tax depreciation rules are published for your country yet.");
  const type = published.rules.statutoryAdditions.find((t) => t.key === input.typeKey);
  if (!type) return fail("Choose the kind of statutory addition.");
  if (!published.rules.pools.some((p) => p.key === input.poolKey)) return fail("Choose one of the classes in the rules.");
  if (!(input.amount > 0)) return fail("Enter the amount.");
  if (!input.description.trim()) return fail("Describe what the amount is for.");
  const legalReference = input.legalReference.trim() || type.legalReference;
  if (!legalReference) return fail("Give the section of the law that allows this addition.");
  if (!input.evidence.trim()) return fail("Name the supporting evidence (a document, a ledger account, a report).");
  const [row] = await db.insert(taxStatutoryAdditions).values({ tenantId, taxYear: input.taxYear, poolKey: input.poolKey, typeKey: input.typeKey, description: input.description.trim(), amount: money(input.amount).toFixed(2), legalReference, evidence: input.evidence.trim(), createdBy: userId }).returning({ id: taxStatutoryAdditions.id });
  await logAuditEvent({ tenantId, userId, action: "tax_statutory_addition_added", entityType: "tax_statutory_additions", entityId: row.id, before: null, after: { ...input, legalReference } });
  return { ok: true };
}

/** Saves one asset's tax details: its own class if it differs, the dates that place it, the period of use, a concession and any review note. */
export async function saveAssetTaxProfile(tenantId: string, userId: string, input: { assetId: string; poolKeyOverride: string | null; enteredClassDate: string | null; costIncurredDate: string | null; periodOfUseYears: number | null; periodBasis: string; concessionKey: string | null; concessionConfirmed: boolean; concessionDocumentation: string; needsReview: boolean; reviewNote: string; taxYear: number }): Promise<Result> {
  const published = await rulesForTaxYear(tenantId, input.taxYear);
  if (!published) return fail("No tax depreciation rules are published for your country yet.");
  const [a] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, input.assetId), eq(assets.tenantId, tenantId))).limit(1);
  if (!a) return fail("That asset was not found.");
  if (input.poolKeyOverride && !published.rules.pools.some((p) => p.key === input.poolKeyOverride)) return fail("Choose one of the classes in the rules.");
  for (const d of [input.enteredClassDate, input.costIncurredDate]) if (d && !isDate(d)) return fail("Enter valid dates.");
  const pool = published.rules.pools.find((p) => p.key === input.poolKeyOverride);
  if (pool?.kind === "individual") {
    if (!(input.periodOfUseYears && input.periodOfUseYears > 0)) return fail("Enter the period of use, in years, for an intangible asset.");
    if (!input.periodBasis.trim()) return fail("Say what the period of use is based on (a contract, a licence, the law).");
  }
  if (input.concessionKey) {
    if (!published.rules.concessions.some((c) => c.key === input.concessionKey)) return fail("Choose one of the concessions in the rules.");
    if (input.concessionConfirmed && !input.concessionDocumentation.trim()) return fail("Name the supporting documents before confirming a concession.");
  }
  const values = {
    poolKeyOverride: input.poolKeyOverride, enteredClassDate: input.enteredClassDate, costIncurredDate: input.costIncurredDate, periodOfUseYears: input.periodOfUseYears ? String(input.periodOfUseYears) : null,
    periodBasis: input.periodBasis.trim() || null, concessionKey: input.concessionKey, concessionConfirmed: Boolean(input.concessionKey) && input.concessionConfirmed, concessionDocumentation: input.concessionDocumentation.trim() || null,
    needsReview: input.needsReview || Boolean(input.concessionKey), reviewNote: input.reviewNote.trim() || null, updatedAt: new Date(),
  };
  const [before] = await db.select().from(assetTaxProfiles).where(eq(assetTaxProfiles.assetId, input.assetId)).limit(1);
  if (before) await db.update(assetTaxProfiles).set(values).where(and(eq(assetTaxProfiles.id, before.id), eq(assetTaxProfiles.tenantId, tenantId)));
  else await db.insert(assetTaxProfiles).values({ tenantId, assetId: input.assetId, ...values });
  await logAuditEvent({ tenantId, userId, action: "asset_tax_profile_saved", entityType: "asset_tax_profiles", entityId: input.assetId, before: before ? { poolKeyOverride: before.poolKeyOverride, concessionKey: before.concessionKey } : null, after: { poolKeyOverride: values.poolKeyOverride, concessionKey: values.concessionKey, concessionConfirmed: values.concessionConfirmed } });
  return { ok: true };
}
