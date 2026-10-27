"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { addCountry, countriesWithUsage, countrySummary, removeCountry, setFiscalYearStart, worldCountries } from "@/lib/countries";

const done = () => {
  revalidatePath("/admin", "layout");
  revalidatePath("/compliance", "layout");
};

export async function getCountriesAdminData() {
  await requirePlatformAdmin();
  const countries = (await countriesWithUsage()).filter((c) => c.isActive);
  const active = new Set(countries.map((c) => c.code));
  return { countries, available: worldCountries().filter((c) => !active.has(c.code)) };
}
export type CountriesAdminData = Awaited<ReturnType<typeof getCountriesAdminData>>;

export async function getCountryPageData(code: string) {
  await requirePlatformAdmin();
  return countrySummary(code);
}

export async function saveFiscalYearStart(code: string, month: number) {
  const admin = await requirePlatformAdmin();
  const r = await setFiscalYearStart(admin.id, code, month);
  if (r.ok) done();
  return r;
}

export async function addNewCountry(input: { code: string; currency: string; calendar: "AD" | "BS"; fiscalYearStartMonth: number }) {
  const admin = await requirePlatformAdmin();
  const r = await addCountry(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function removeActiveCountry(code: string) {
  const admin = await requirePlatformAdmin();
  const r = await removeCountry(admin.id, code);
  if (r.ok) done();
  return r;
}
