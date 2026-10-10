"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { listPlatformTaxRates, publishTaxRate, updatePublishedRate, type PublishInput } from "@/lib/compliance/platform-tax-rates";

// Tax rates for a whole country, for the platform administrator. Every action checks for one first; nothing here is scoped to an
// organization, and publishing writes the rate into every organization of the country.

const done = () => {
  revalidatePath("/admin/compliance/tax-rates");
  revalidatePath("/compliance", "layout");
};

export async function getTaxRateAdminData(countryCode?: string) {
  await requirePlatformAdmin();
  const countries = await db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name));
  const country = countries.find((c) => c.code === countryCode) ?? countries[0] ?? null;
  const today = todayIso();
  return { countries, country, today, rates: country ? await listPlatformTaxRates(country.code, today) : null };
}
export type TaxRateAdminData = Awaited<ReturnType<typeof getTaxRateAdminData>>;

export async function publishRate(input: PublishInput) {
  const admin = await requirePlatformAdmin();
  const r = await publishTaxRate(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function editPublishedRate(input: { id: string; isVerified: boolean; source: string }) {
  const admin = await requirePlatformAdmin();
  const r = await updatePublishedRate(admin.id, input);
  if (r.ok) done();
  return r;
}
