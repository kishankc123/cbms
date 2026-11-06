"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { listRuleVersions, publishRuleVersion, updateRuleVersionNotes } from "@/lib/tax-depreciation/platform-rules";

// Tax depreciation rules for a whole country, for the platform administrator. Every action checks for one first.

export async function getTaxDepreciationRulesAdminData(countryCode: string) {
  await requirePlatformAdmin();
  const [country] = await db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.code, countryCode)).limit(1);
  const today = todayIso();
  return { country: country ?? null, today, versions: country ? await listRuleVersions(country.code, today) : [] };
}
export type TaxDepreciationRulesAdminData = Awaited<ReturnType<typeof getTaxDepreciationRulesAdminData>>;

const done = () => revalidatePath("/admin/compliance", "layout");

export async function publishTaxDepreciationRules(input: { countryCode: string; effectiveFrom: string; rulesJson: string; isVerified: boolean; source: string }) {
  const admin = await requirePlatformAdmin();
  let rules: unknown;
  try {
    rules = JSON.parse(input.rulesJson);
  } catch {
    return { ok: false as const, error: "The rules are not written correctly. Check the brackets, commas and quotes." };
  }
  const r = await publishRuleVersion(admin.id, { countryCode: input.countryCode, effectiveFrom: input.effectiveFrom, rules, isVerified: input.isVerified, source: input.source });
  if (r.ok) done();
  return r;
}

export async function editTaxDepreciationRuleNotes(input: { id: string; isVerified: boolean; source: string }) {
  const admin = await requirePlatformAdmin();
  const r = await updateRuleVersionNotes(admin.id, input);
  if (r.ok) done();
  return r;
}
