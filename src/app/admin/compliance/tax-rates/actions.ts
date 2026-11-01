"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { confirmCarryForward, ensureCarryForward, fiscalYearsFor, listPlatformTaxRates, listRateDrafts, publishTaxRate, updatePublishedRate, type PublishInput } from "@/lib/compliance/platform-tax-rates";

// Tax rates for a whole country, for the platform administrator. Every action checks for one first; nothing here is scoped to an
// organization, and publishing writes the rate into every organization of the country.

const done = () => {
  revalidatePath("/admin/compliance", "layout");
  revalidatePath("/compliance", "layout");
};

export async function getTaxRateAdminData(countryCode?: string) {
  await requirePlatformAdmin();
  const countries = await db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name));
  const country = countries.find((c) => c.code === countryCode) ?? countries[0] ?? null;
  const today = todayIso();
  if (country) await ensureCarryForward(country.code, today);
  return {
    countries,
    country,
    today,
    rates: country ? await listPlatformTaxRates(country.code, today) : null,
    years: country ? await fiscalYearsFor(country.code, today) : [],
    drafts: country ? await listRateDrafts(country.code) : [],
  };
}
export type TaxRateAdminData = Awaited<ReturnType<typeof getTaxRateAdminData>>;

export async function publishRate(input: PublishInput) {
  const admin = await requirePlatformAdmin();
  const r = await publishTaxRate(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function confirmDraft(input: { draftId: string; rate: number; effectiveFrom: string; source: string; isVerified: boolean }) {
  const admin = await requirePlatformAdmin();
  const r = await confirmCarryForward(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function editPublishedRate(input: { id: string; isVerified: boolean; source: string }) {
  const admin = await requirePlatformAdmin();
  const r = await updatePublishedRate(admin.id, input);
  if (r.ok) done();
  return r;
}
