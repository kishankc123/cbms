"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { addSetupItem, isSetupSection, listSetup, SETUP_SECTIONS, updateSetupItem } from "@/lib/country-setup";
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

export async function getSetupListData(code: string, section: string) {
  await requirePlatformAdmin();
  const summary = await countrySummary(code);
  if (!summary || !isSetupSection(section)) return null;
  const { rows, authorities } = await listSetup(code, section);
  return { countryCode: code, countryName: summary.country.name, section, title: SETUP_SECTIONS[section].title, singular: SETUP_SECTIONS[section].singular, rows, authorities };
}
export type SetupListData = Awaited<ReturnType<typeof getSetupListData>>;

export async function addCountrySetupItem(code: string, section: string, input: { name: string; authorityKey?: string; isRegistrable?: boolean }) {
  const admin = await requirePlatformAdmin();
  if (!isSetupSection(section)) return { ok: false as const, error: "That list doesn't exist." };
  const r = await addSetupItem(admin.id, code, section, input);
  if (r.ok) done();
  return r;
}

export async function changeCountrySetupItem(section: string, id: string, input: { name?: string; authorityKey?: string; isActive?: boolean }) {
  const admin = await requirePlatformAdmin();
  if (!isSetupSection(section)) return { ok: false as const, error: "That list doesn't exist." };
  const r = await updateSetupItem(admin.id, section, id, input);
  if (r.ok) done();
  return r;
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
