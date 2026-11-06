import { and, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { assetDisposals, assets, assetTaxProfiles, taxDeferredAdditions, taxDepreciationPools, taxDepreciationYears, taxPoolOpenings, taxStatutoryAdditions } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { additionDate, taxYearStarting } from "./dates";
import { computePool, type AdditionIn, type ConcessionUse, type DeferredIn, type DisposalIn, type PoolResult, type StatutoryIn } from "./engine";
import type { PoolRule, TaxDepreciationRules } from "./rules";
import { ensureTaxCategoryMap, rulesForTaxYear } from "./setup";

// A tax year's depreciation for an organization: the preview worked out live from the asset register, the opening balances, the deferred-addition
// register and the statutory additions, and the finalised copy that keeps the rules it used. Nothing here posts to the ledger or changes book depreciation.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type PoolPreview = {
  key: string;
  assetId: string | null;
  label: string;
  result: PoolResult;
  /** the register rows that fell due into this class this year */
  deferredIds: string[];
  /** assets whose disposals were counted */
  disposedAssetIds: string[];
};

export type YearPreview = {
  taxYear: number;
  label: string;
  from: string;
  to: string;
  rulesVersionId: string;
  rules: TaxDepreciationRules;
  rulesVerified: boolean;
  pools: PoolPreview[];
  /** Things that stop the year being finalised (an asset without a date, an intangible without its period of use). */
  blocking: string[];
  warnings: string[];
  totals: { totalDeduction: number; balancingCharge: number; terminalDeduction: number };
  /** Set when the year has been finalised: the numbers then come from the saved copy, not the live books. */
  final: { id: string; finalisedAt: Date } | null;
};

export type YearResult = { ok: true; preview: YearPreview } | { ok: false; error: string };

type Member = { id: string; code: string; name: string; poolKey: string; date: string | null; cost: number; source: string; profile: typeof assetTaxProfiles.$inferSelect | undefined; reviewByCategory: boolean };

export async function previewTaxYear(tenantId: string, taxYear: number): Promise<YearResult> {
  const published = await rulesForTaxYear(tenantId, taxYear);
  if (!published) return { ok: false, error: "No tax depreciation rules are published for your country for this tax year." };
  const rules = published.rules;
  const ty = taxYearStarting(taxYear, rules);
  if (!ty) return { ok: false, error: "That tax year is outside the supported calendar." };

  // A finalised year is shown as it was saved.
  const [final] = await db.select().from(taxDepreciationYears).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.taxYear, taxYear), eq(taxDepreciationYears.status, "final"))).limit(1);
  if (final) {
    const rows = await db.select().from(taxDepreciationPools).where(and(eq(taxDepreciationPools.yearId, final.id), eq(taxDepreciationPools.tenantId, tenantId)));
    return {
      ok: true,
      preview: {
        taxYear, label: ty.label, from: ty.from, to: ty.to, rulesVersionId: final.rulesVersionId ?? "", rules: final.rules as TaxDepreciationRules, rulesVerified: final.rulesVerified,
        pools: rows.map((r) => ({ key: r.poolKey, assetId: r.assetId, label: r.label, result: r.result as PoolResult, deferredIds: [], disposedAssetIds: [] })),
        blocking: [], warnings: [], totals: { totalDeduction: Number(final.totalDeduction), balancingCharge: Number(final.balancingCharge), terminalDeduction: Number(final.terminalDeduction) },
        final: { id: final.id, finalisedAt: final.finalisedAt },
      },
    };
  }

  const [categoryMap, assetRows, profiles, disposals, openings, deferred, statutory, previous] = await Promise.all([
    ensureTaxCategoryMap(tenantId),
    db.select().from(assets).where(and(eq(assets.tenantId, tenantId), ne(assets.status, "draft"), ne(assets.status, "voided"))),
    db.select().from(assetTaxProfiles).where(eq(assetTaxProfiles.tenantId, tenantId)),
    db.select().from(assetDisposals).where(and(eq(assetDisposals.tenantId, tenantId), eq(assetDisposals.status, "posted"), lte(assetDisposals.disposalDate, ty.to))),
    db.select().from(taxPoolOpenings).where(and(eq(taxPoolOpenings.tenantId, tenantId), eq(taxPoolOpenings.taxYear, taxYear))),
    db.select().from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, tenantId), eq(taxDeferredAdditions.status, "pending"), lte(taxDeferredAdditions.dueTaxYear, taxYear))),
    db.select().from(taxStatutoryAdditions).where(and(eq(taxStatutoryAdditions.tenantId, tenantId), eq(taxStatutoryAdditions.taxYear, taxYear))),
    db.select({ pool: taxDepreciationPools, yearStatus: taxDepreciationYears.status }).from(taxDepreciationPools).innerJoin(taxDepreciationYears, eq(taxDepreciationYears.id, taxDepreciationPools.yearId)).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.taxYear, taxYear - 1), eq(taxDepreciationYears.status, "final"))),
  ]);
  const catInfo = new Map(categoryMap.map((c) => [c.categoryId, c]));
  const profileOf = new Map(profiles.map((p) => [p.assetId, p]));
  const disposalOf = new Map(disposals.map((d) => [d.assetId, d]));
  const poolRule = new Map(rules.pools.map((p) => [p.key, p]));
  const blocking: string[] = [];
  const warnings: string[] = [];

  // Which class each asset belongs to, and the date it counts from.
  const members: Member[] = [];
  for (const a of assetRows) {
    const profile = profileOf.get(a.id);
    const cat = catInfo.get(a.categoryId);
    const poolKey = profile?.poolKeyOverride ?? cat?.poolKey ?? null;
    if (!poolKey) continue; // no tax class (land)
    if (!poolRule.has(poolKey)) {
      warnings.push(`${a.assetCode} ${a.name} is in class ${poolKey}, which is not in the published rules, so it was left out.`);
      continue;
    }
    const date = additionDate(profile?.enteredClassDate ?? a.availableForUseDate ?? a.purchaseDate, profile?.costIncurredDate ?? a.purchaseDate);
    members.push({ id: a.id, code: a.assetCode, name: a.name, poolKey, date, cost: Number(a.capitalizedCost), source: a.source, profile, reviewByCategory: !profile?.poolKeyOverride && Boolean(cat?.needsReview) });
  }

  type Group = { key: string; rule: PoolRule; assetId: string | null; label: string; members: Member[] };
  const groups: Group[] = [];
  for (const rule of rules.pools) {
    const inClass = members.filter((m) => m.poolKey === rule.key);
    if (rule.kind === "pooled") groups.push({ key: rule.key, rule, assetId: null, label: rule.label, members: inClass });
    else for (const m of inClass) groups.push({ key: rule.key, rule, assetId: m.id, label: `${m.code} ${m.name} (Class ${rule.key})`, members: [m] });
  }
  // A balance entered for an intangible asset that has no register entry still counts.
  const asKey = (key: string, assetId: string | null) => `${key}|${assetId ?? ""}`;
  for (const o of openings) {
    const rule = poolRule.get(o.poolKey);
    if (rule && rule.kind === "individual" && o.assetId && !groups.some((g) => g.key === o.poolKey && g.assetId === o.assetId)) warnings.push(`A balance was entered for an intangible asset that is not in the register or has no tax class (class ${o.poolKey}).`);
  }

  const previousClosing = new Map(previous.map((p) => [asKey(p.pool.poolKey, p.pool.assetId), Number(p.pool.closingWdv)]));
  const manualOpening = new Map(openings.map((o) => [asKey(o.poolKey, o.assetId), Number(o.openingWdv)]));

  const pools: PoolPreview[] = [];
  for (const g of groups) {
    const gk = asKey(g.key, g.assetId);
    const membersToDate = g.members.filter((m) => m.date === null || m.date <= ty.to);
    for (const m of g.members) if (m.date === null) blocking.push(`${m.code} ${m.name} has no purchase or available-for-use date, so it can't be placed in a tax year. Add a date on its tax details.`);

    const additions: AdditionIn[] = g.members.filter((m) => m.date !== null && m.date >= ty.from && m.date <= ty.to).map((m) => ({ id: m.id, label: `${m.code} ${m.name}`, cost: m.cost, date: m.date as string, concessionKey: m.profile?.concessionKey && m.profile.concessionKey !== "extra_third_rate" ? m.profile.concessionKey : undefined }));
    const disposalsIn: DisposalIn[] = [];
    for (const m of membersToDate) {
      const d = disposalOf.get(m.id);
      if (d && d.disposalDate >= ty.from && d.disposalDate <= ty.to) disposalsIn.push({ assetId: m.id, proceeds: d.kind === "sale" ? Number(d.saleAmount) : 0, date: d.disposalDate });
    }
    const dissolved = membersToDate.length > 0 && disposalsIn.length > 0 && membersToDate.every((m) => { const d = disposalOf.get(m.id); return Boolean(d) && (d as { disposalDate: string }).disposalDate <= ty.to; });

    const due = deferred.filter((d) => d.poolKey === g.key && (g.rule.kind === "pooled" ? true : d.assetId === g.assetId));
    const priorDeferred: DeferredIn[] = due.map((d) => ({ id: d.id, amount: Number(d.remainingDeferred) }));
    const stat: StatutoryIn[] = g.rule.kind === "pooled" ? statutory.filter((s) => s.poolKey === g.key).map((s) => ({ type: s.typeKey, label: s.description, amount: Number(s.amount), legalReference: s.legalReference, evidence: s.evidence })) : [];

    // The opening balance is what was entered, or else what the same class closed with last year.
    const hadBefore = membersToDate.some((m) => m.date !== null && m.date < ty.from);
    let opening = manualOpening.get(gk);
    if (opening === undefined) opening = previousClosing.get(gk);
    if (opening === undefined) {
      opening = 0;
      if (hadBefore) warnings.push(`${g.label}: no balance brought forward was entered, so it starts at 0. Enter it under Balances brought forward.`);
    }

    // Concessions an asset has asked for count only when every asset asking confirmed them with documents.
    const uses = new Map<string, { confirmed: boolean; docs: string[] }>();
    for (const m of g.members) {
      const key = m.profile?.concessionKey;
      if (!key) continue;
      const u = uses.get(key) ?? { confirmed: true, docs: [] };
      u.confirmed = u.confirmed && Boolean(m.profile?.concessionConfirmed && m.profile.concessionDocumentation?.trim());
      if (m.profile?.concessionDocumentation) u.docs.push(m.profile.concessionDocumentation);
      uses.set(key, u);
    }
    const concessions: ConcessionUse[] = [...uses].map(([key, u]) => ({ key, confirmed: u.confirmed, documentation: u.docs.join("; ") }));

    const hasAnything = opening > 0 || additions.length > 0 || priorDeferred.length > 0 || stat.length > 0 || disposalsIn.length > 0;
    if (!hasAnything) continue;
    const period = g.members[0]?.profile?.periodOfUseYears ? Number(g.members[0].profile.periodOfUseYears) : null;
    if (g.rule.kind === "individual" && !g.members[0]?.profile?.periodBasis?.trim() && period) blocking.push(`${g.label}: say what the period of use is based on.`);
    try {
      const result = computePool({ pool: g.rule, rules, openingWdv: opening, additions, priorDeferred, statutory: stat, disposals: disposalsIn, dissolved, periodOfUseYears: period, concessions, needsReview: g.members.some((m) => m.profile?.needsReview || m.reviewByCategory) });
      pools.push({ key: g.key, assetId: g.assetId, label: g.label, result, deferredIds: due.map((d) => d.id), disposedAssetIds: disposalsIn.map((d) => d.assetId) });
    } catch (e) {
      blocking.push(`${g.label}: ${e instanceof Error ? e.message : "could not be calculated."}`);
    }
  }
  // A deferred amount for a class nothing else touches still has to join its class.
  for (const d of deferred) {
    if (!pools.some((p) => p.key === d.poolKey && (p.assetId === null || p.assetId === d.assetId))) warnings.push(`A deferred amount of ${Number(d.remainingDeferred).toFixed(2)} for ${d.assetLabel} (class ${d.poolKey}) has no class to join this year. Check the class and its assets.`);
  }

  const sum = (f: (r: PoolResult) => number) => round2(pools.reduce((s, p) => s + f(p.result), 0));
  return {
    ok: true,
    preview: {
      taxYear, label: ty.label, from: ty.from, to: ty.to, rulesVersionId: published.id, rules, rulesVerified: published.isVerified, pools, blocking: [...new Set(blocking)], warnings: [...new Set(warnings)],
      totals: { totalDeduction: sum((r) => r.totalDeduction), balancingCharge: sum((r) => r.balancingCharge), terminalDeduction: sum((r) => r.terminalDeduction) }, final: null,
    },
  };
}

type Done = { ok: true } | { ok: false; error: string };

/** Saves the year as calculated, with the rules it used, and updates the deferred-addition register. A year can be finalised only once. */
export async function finaliseTaxYear(tenantId: string, userId: string, taxYear: number): Promise<Done> {
  const r = await previewTaxYear(tenantId, taxYear);
  if (!r.ok) return r;
  const p = r.preview;
  if (p.final) return { ok: false, error: "This tax year is already finalised." };
  if (p.blocking.length > 0) return { ok: false, error: `Fix these first: ${p.blocking.join(" ")}` };
  if (p.pools.length === 0) return { ok: false, error: "There is nothing to calculate for this tax year." };
  const [laterFinal] = await db.select({ id: taxDepreciationYears.id }).from(taxDepreciationYears).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.taxYear, taxYear + 1), eq(taxDepreciationYears.status, "final"))).limit(1);
  if (laterFinal) return { ok: false, error: "A later tax year is already finalised. Reopen it first." };

  // The deferred rows this year makes must not collide with ones already in the register.
  const newRows = p.pools.filter((x) => !x.result.dissolved).flatMap((x) => x.result.additionLines.filter((l) => l.deferred > 0).map((l) => ({ pool: x, line: l })));
  if (newRows.length) {
    const existing = await db.select({ assetId: taxDeferredAdditions.assetId, date: taxDeferredAdditions.originalDate }).from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, tenantId), inArray(taxDeferredAdditions.assetId, newRows.map((n) => n.line.id)), ne(taxDeferredAdditions.status, "cancelled")));
    const clash = newRows.find((n) => existing.some((e) => e.assetId === n.line.id && e.date === n.line.date));
    if (clash) return { ok: false, error: `${clash.line.label} already has a deferred amount in the register for that date. Cancel the entry made by hand, or leave this asset out of the opening register.` };
  }

  await db.transaction(async (tx) => {
    const [year] = await tx.insert(taxDepreciationYears).values({
      tenantId, taxYear, status: "final", rulesVersionId: p.rulesVersionId, rules: p.rules, rulesVerified: p.rulesVerified, legalReference: p.rules.legalReference,
      totalDeduction: p.totals.totalDeduction.toFixed(2), balancingCharge: p.totals.balancingCharge.toFixed(2), terminalDeduction: p.totals.terminalDeduction.toFixed(2), finalisedBy: userId,
    }).returning({ id: taxDepreciationYears.id });
    await tx.insert(taxDepreciationPools).values(p.pools.map((x) => ({ yearId: year.id, tenantId, poolKey: x.key, assetId: x.assetId, label: x.label, result: x.result, closingWdv: x.result.closingWdv.toFixed(2), totalDeduction: x.result.totalDeduction.toFixed(2), balancingCharge: x.result.balancingCharge.toFixed(2), terminalDeduction: x.result.terminalDeduction.toFixed(2) })));
    for (const x of p.pools) {
      if (x.result.dissolved) {
        // The class is closed: everything still waiting in it is settled by the dissolution.
        const rows = await tx.select({ id: taxDeferredAdditions.id, assetId: taxDeferredAdditions.assetId }).from(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, tenantId), eq(taxDeferredAdditions.poolKey, x.key), eq(taxDeferredAdditions.status, "pending")));
        const ids = rows.filter((d) => x.assetId === null || d.assetId === x.assetId).map((d) => d.id);
        if (ids.length) await tx.update(taxDeferredAdditions).set({ status: "settled", includedInTaxYear: taxYear }).where(and(eq(taxDeferredAdditions.tenantId, tenantId), inArray(taxDeferredAdditions.id, ids)));
      } else if (x.deferredIds.length) {
        await tx.update(taxDeferredAdditions).set({ status: "included", includedInTaxYear: taxYear }).where(and(eq(taxDeferredAdditions.tenantId, tenantId), inArray(taxDeferredAdditions.id, x.deferredIds)));
      }
    }
    if (newRows.length) {
      await tx.insert(taxDeferredAdditions).values(newRows.map(({ pool, line }) => ({
        tenantId, assetId: line.id, assetLabel: line.label, poolKey: pool.key, originalTaxYear: taxYear, originalDate: line.date, originalCost: line.cost.toFixed(2), originalThirds: line.thirds,
        includedInOriginalYear: round2(line.currentYear + line.sameYearDeduction).toFixed(2), remainingDeferred: line.deferred.toFixed(2), dueTaxYear: taxYear + 1, status: "pending", source: "calculated", createdBy: userId,
      })));
    }
  });
  await logAuditEvent({ tenantId, userId, action: "tax_depreciation_year_finalised", entityType: "tax_depreciation_years", entityId: String(taxYear), before: null, after: { taxYear, totals: p.totals, rulesVersionId: p.rulesVersionId, rulesVerified: p.rulesVerified } });
  return { ok: true };
}

/** Takes a finalised year back to a preview so it can be corrected. The saved copy is kept as "reopened". Only the latest finalised year can be reopened. */
export async function reopenTaxYear(tenantId: string, userId: string, taxYear: number, reason: string): Promise<Done> {
  if (!reason.trim()) return { ok: false, error: "Give a reason for reopening a finalised tax year." };
  const [year] = await db.select().from(taxDepreciationYears).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.taxYear, taxYear), eq(taxDepreciationYears.status, "final"))).limit(1);
  if (!year) return { ok: false, error: "This tax year is not finalised." };
  const [later] = await db.select({ id: taxDepreciationYears.id }).from(taxDepreciationYears).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.taxYear, taxYear + 1), eq(taxDepreciationYears.status, "final"))).limit(1);
  if (later) return { ok: false, error: "A later tax year is finalised. Reopen the latest year first." };
  await db.transaction(async (tx) => {
    await tx.update(taxDepreciationYears).set({ status: "reopened", reopenedBy: userId, reopenedAt: new Date(), reopenReason: reason.trim() }).where(and(eq(taxDepreciationYears.id, year.id), eq(taxDepreciationYears.tenantId, tenantId)));
    await tx.update(taxDeferredAdditions).set({ status: "pending", includedInTaxYear: null }).where(and(eq(taxDeferredAdditions.tenantId, tenantId), eq(taxDeferredAdditions.includedInTaxYear, taxYear), inArray(taxDeferredAdditions.status, ["included", "settled"])));
    await tx.delete(taxDeferredAdditions).where(and(eq(taxDeferredAdditions.tenantId, tenantId), eq(taxDeferredAdditions.originalTaxYear, taxYear), eq(taxDeferredAdditions.source, "calculated")));
  });
  await logAuditEvent({ tenantId, userId, action: "tax_depreciation_year_reopened", entityType: "tax_depreciation_years", entityId: String(taxYear), before: { totalDeduction: year.totalDeduction }, after: { status: "reopened", reason: reason.trim() } });
  return { ok: true };
}

/** Finalised years, newest first. */
export async function listFinalisedYears(tenantId: string) {
  return db.select({ taxYear: taxDepreciationYears.taxYear, finalisedAt: taxDepreciationYears.finalisedAt, totalDeduction: taxDepreciationYears.totalDeduction, rulesVerified: taxDepreciationYears.rulesVerified }).from(taxDepreciationYears).where(and(eq(taxDepreciationYears.tenantId, tenantId), eq(taxDepreciationYears.status, "final"))).orderBy(desc(taxDepreciationYears.taxYear));
}
