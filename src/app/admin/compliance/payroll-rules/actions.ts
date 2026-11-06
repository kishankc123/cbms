"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { listRuleVersions, publishRuleVersion, updateRuleVersionNotes } from "@/lib/payroll/platform-rules";

// Payroll rules for a whole country, for the platform administrator. Every action checks for one first.

export async function getPayrollRulesAdminData(countryCode: string) {
  await requirePlatformAdmin();
  const [country] = await db.select({ code: complianceCountries.code, name: complianceCountries.name, currency: complianceCountries.currency }).from(complianceCountries).where(eq(complianceCountries.code, countryCode)).orderBy(asc(complianceCountries.name)).limit(1);
  const today = todayIso();
  return { country: country ?? null, today, versions: country ? await listRuleVersions(country.code, today) : [] };
}
export type PayrollRulesAdminData = Awaited<ReturnType<typeof getPayrollRulesAdminData>>;

const done = () => revalidatePath("/admin/compliance", "layout");

export async function publishPayrollRules(input: { countryCode: string; effectiveFrom: string; rules: unknown; isVerified: boolean; source: string }) {
  const admin = await requirePlatformAdmin();
  const r = await publishRuleVersion(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function editPayrollRuleNotes(input: { id: string; isVerified: boolean; source: string }) {
  const admin = await requirePlatformAdmin();
  const r = await updateRuleVersionNotes(admin.id, input);
  if (r.ok) done();
  return r;
}
