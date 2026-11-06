import { and, between, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { assetDepreciationLines, assetDepreciationRuns, assetDisposals, assets, assetTaxProfiles, taxDepreciationYears, tenants } from "@/db/schema";
import { taxYearOf } from "./dates";
import { taxDepreciationRulesOn } from "./platform-rules";
import type { YearPreview } from "./year";
import { ensureTaxCategoryMap, rulesForTaxYear } from "./setup";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---- The books beside the tax figures ----

export type BooksVsTax = {
  bookDepreciation: number;
  taxDeduction: number;
  /** Tax deduction less book depreciation: positive means tax allows more than the books charged. */
  depreciationDifference: number;
  bookDisposalGainLoss: number;
  /** Balancing charge less terminal deduction: positive is taxable income. */
  taxDisposalResult: number;
};

/** Accounting depreciation and gains on disposal in the tax year, beside the tax figures. Read only: it never touches the books. */
export async function booksVsTax(tenantId: string, preview: YearPreview): Promise<BooksVsTax> {
  const lines = await db
    .select({ amount: assetDepreciationLines.amount })
    .from(assetDepreciationLines)
    .innerJoin(assetDepreciationRuns, eq(assetDepreciationRuns.id, assetDepreciationLines.runId))
    .where(and(eq(assetDepreciationLines.tenantId, tenantId), eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.status, "posted"), between(assetDepreciationRuns.periodEnd, preview.from, preview.to)));
  const disposals = await db.select({ gain: assetDisposals.gainLoss }).from(assetDisposals).where(and(eq(assetDisposals.tenantId, tenantId), eq(assetDisposals.status, "posted"), between(assetDisposals.disposalDate, preview.from, preview.to)));
  const bookDepreciation = round2(lines.reduce((s, l) => s + Number(l.amount), 0));
  const taxDeduction = round2(preview.totals.totalDeduction);
  return {
    bookDepreciation,
    taxDeduction,
    depreciationDifference: round2(taxDeduction - bookDepreciation),
    bookDisposalGainLoss: round2(disposals.reduce((s, d) => s + Number(d.gain), 0)),
    taxDisposalResult: round2(preview.totals.balancingCharge - preview.totals.terminalDeduction),
  };
}

// ---- Things a person should look at ----

export type ReviewItem = { id: string; kind: "category" | "asset" | "concession" | "period" | "rules"; title: string; detail: string; tab: "classes" | "assets" | "calculation" };

/** Everything that needs a person's decision before the tax figures can be trusted: unclear classes, flagged assets, unconfirmed concessions, missing periods of use, years finalised on unverified rules. */
export async function reviewItems(tenantId: string, taxYear: number): Promise<ReviewItem[]> {
  const published = await rulesForTaxYear(tenantId, taxYear);
  if (!published) return [];
  const individual = new Set(published.rules.pools.filter((p) => p.kind === "individual").map((p) => p.key));
  const [categories, rows, years] = await Promise.all([
    ensureTaxCategoryMap(tenantId),
    db.select({ asset: assets, profile: assetTaxProfiles }).from(assets).leftJoin(assetTaxProfiles, eq(assetTaxProfiles.assetId, assets.id)).where(and(eq(assets.tenantId, tenantId), ne(assets.status, "draft"), ne(assets.status, "voided"))),
    db.select({ taxYear: taxDepreciationYears.taxYear, verified: taxDepreciationYears.rulesVerified }).from(taxDepreciationYears).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.status, "final"))),
  ]);
  const catById = new Map(categories.map((c) => [c.categoryId, c]));
  const out: ReviewItem[] = [];
  for (const c of categories) if (c.needsReview && c.isActive) out.push({ id: `cat-${c.categoryId}`, kind: "category", title: `${c.name}: confirm the tax class`, detail: c.reason, tab: "classes" });
  for (const { asset: a, profile: p } of rows) {
    const label = `${a.assetCode} ${a.name}`;
    if (p?.needsReview) out.push({ id: `asset-${a.id}`, kind: "asset", title: `${label} is marked for review`, detail: p.reviewNote ?? "No note was left.", tab: "assets" });
    if (p?.concessionKey && !p.concessionConfirmed) out.push({ id: `conc-${a.id}`, kind: "concession", title: `${label}: concession not confirmed`, detail: "It is not applied until the legal conditions are confirmed with supporting documents.", tab: "assets" });
    const cls = p?.poolKeyOverride ?? catById.get(a.categoryId)?.poolKey ?? "";
    if (individual.has(cls) && (!p?.periodOfUseYears || !p.periodBasis?.trim())) out.push({ id: `per-${a.id}`, kind: "period", title: `${label}: period of use needed`, detail: "An intangible asset needs its period of use and what it is based on.", tab: "assets" });
  }
  for (const y of years) if (!y.verified) out.push({ id: `rules-${y.taxYear}`, kind: "rules", title: `Tax year ${y.taxYear} was finalised on rules not yet verified`, detail: "Check the published rules against current law.", tab: "calculation" });
  return out;
}

/** The tax year that contains a date, for an organization's country. null when its country has no published rules (so there is nothing to review). */
export async function currentTaxYearFor(tenantId: string, today: string): Promise<number | null> {
  const [t] = await db.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) return null;
  const published = await taxDepreciationRulesOn(t.country, today);
  return published ? (taxYearOf(today, published.rules)?.startYear ?? null) : null;
}
