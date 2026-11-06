import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformTaxDepreciationRuleVersions } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addDays } from "@/lib/calendar";
import { checkTaxDepreciationRules, sameTaxDepreciationRules, type TaxDepreciationRules } from "./rules";

// Tax depreciation rules published for a whole country by a platform administrator, in dated versions. A new version starts after the latest one
// (which ends the day before) or before the earliest, never in the middle of history. Tax depreciation reads the version in force for the tax year
// and records which one it used, so finalized years never change when the law does.

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());

export type RuleVersion = { id: string; effectiveFrom: string; effectiveTo: string | null; rules: TaxDepreciationRules; isVerified: boolean; source: string | null; inForce: boolean };

export async function listRuleVersions(countryCode: string, today: string): Promise<RuleVersion[]> {
  const rows = await db.select().from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, countryCode)).orderBy(asc(platformTaxDepreciationRuleVersions.effectiveFrom));
  return rows.map((r) => ({ id: r.id, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, rules: r.rules as TaxDepreciationRules, isVerified: r.isVerified, source: r.source, inForce: r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today) }));
}

/** The rules that apply on a date (what tax depreciation uses), or null when nothing is published for it. */
export async function taxDepreciationRulesOn(countryCode: string, date: string): Promise<{ id: string; rules: TaxDepreciationRules; isVerified: boolean } | null> {
  const found = (await listRuleVersions(countryCode, date)).find((v) => v.effectiveFrom <= date && (!v.effectiveTo || v.effectiveTo >= date));
  return found ? { id: found.id, rules: found.rules, isVerified: found.isVerified } : null;
}

type Result = { ok: true } | { ok: false; error: string };

export async function publishRuleVersion(adminId: string, input: { countryCode: string; effectiveFrom: string; rules: unknown; isVerified: boolean; source: string }): Promise<Result> {
  if (!isDate(input.effectiveFrom)) return { ok: false, error: "Enter a valid date for the rules to start from." };
  const checked = checkTaxDepreciationRules(input.rules);
  if (!checked.ok) return checked;
  const all = await db.select().from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, input.countryCode)).orderBy(asc(platformTaxDepreciationRuleVersions.effectiveFrom));
  const latest = all[all.length - 1];
  const earliest = all[0];
  const backfill = Boolean(earliest) && input.effectiveFrom < earliest.effectiveFrom;
  if (latest && !backfill) {
    if (input.effectiveFrom <= latest.effectiveFrom) return { ok: false, error: `The new rules have to start after ${latest.effectiveFrom}, when the current ones started.` };
    if (sameTaxDepreciationRules(latest.rules as TaxDepreciationRules, checked.rules)) return { ok: false, error: "These are the same rules as the current ones. Change something first." };
  }
  await db.transaction(async (tx) => {
    if (latest && !backfill) await tx.update(platformTaxDepreciationRuleVersions).set({ effectiveTo: addDays(input.effectiveFrom, -1) }).where(eq(platformTaxDepreciationRuleVersions.id, latest.id));
    await tx.insert(platformTaxDepreciationRuleVersions).values({ countryCode: input.countryCode, effectiveFrom: input.effectiveFrom, effectiveTo: backfill ? addDays(earliest.effectiveFrom, -1) : null, rules: checked.rules, isVerified: input.isVerified, source: input.source.trim() || null, createdBy: adminId });
  });
  await logAuditEvent({ tenantId: null, userId: adminId, action: "platform_tax_depreciation_rules_published", entityType: "platform_tax_depreciation_rules", entityId: input.countryCode, before: latest ? { effectiveFrom: latest.effectiveFrom, rules: latest.rules } : null, after: { effectiveFrom: input.effectiveFrom, rules: checked.rules, source: input.source.trim() || null, isVerified: input.isVerified } });
  return { ok: true };
}

/** Ticks or unticks "verified" and edits the source. The rules and the date never change once published. */
export async function updateRuleVersionNotes(adminId: string, input: { id: string; isVerified: boolean; source: string }): Promise<Result> {
  const [row] = await db.select().from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.id, input.id)).limit(1);
  if (!row) return { ok: false, error: "That version was not found." };
  await db.update(platformTaxDepreciationRuleVersions).set({ isVerified: input.isVerified, source: input.source.trim() || null }).where(and(eq(platformTaxDepreciationRuleVersions.id, input.id), eq(platformTaxDepreciationRuleVersions.countryCode, row.countryCode)));
  await logAuditEvent({ tenantId: null, userId: adminId, action: "platform_tax_depreciation_rules_updated", entityType: "platform_tax_depreciation_rules", entityId: row.countryCode, before: { isVerified: row.isVerified, source: row.source, effectiveFrom: row.effectiveFrom }, after: { isVerified: input.isVerified, source: input.source.trim() || null, effectiveFrom: row.effectiveFrom } });
  return { ok: true };
}
