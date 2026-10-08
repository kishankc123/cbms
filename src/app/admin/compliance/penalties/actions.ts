"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { bsFiscalYearOf, bsFiscalYearRange, todayIso } from "@/lib/calendar";
import { createPenaltyVersion, deletePenaltyVersion, listPenaltyTimeline, updatePenaltyVersion, type NewVersionInput, type UpdateVersionInput } from "@/lib/compliance/penalty-admin";

// Fines and penalties, for the platform administrator. Every action checks for one first; nothing here is scoped to an
// organization, and every organization reads the result.

const done = () => {
  revalidatePath("/admin/compliance/penalties");
  revalidatePath("/compliance/penalties");
};

export async function getPenaltyAdminData(countryCode?: string) {
  await requirePlatformAdmin();
  const countries = await db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name));
  const country = countries.find((c) => c.code === countryCode) ?? countries[0] ?? null;
  const today = todayIso();
  const startYear = bsFiscalYearOf(today)?.startYear ?? 2083;
  // A new version can start in any fiscal year from a few years back to a few ahead, as long as it is after the latest one.
  const fiscalYears = [];
  for (let y = startYear - 6; y <= startYear + 4; y++) {
    const r = bsFiscalYearRange(y);
    if (r) fiscalYears.push({ startYear: y, label: r.label, from: r.from });
  }
  return { countries, country, today, fiscalYears, timeline: country ? await listPenaltyTimeline(country.code, today) : null };
}
export type PenaltyAdminData = Awaited<ReturnType<typeof getPenaltyAdminData>>;

export async function addPenaltyVersion(input: NewVersionInput) {
  const admin = await requirePlatformAdmin();
  const r = await createPenaltyVersion(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function editPenaltyVersion(input: UpdateVersionInput) {
  const admin = await requirePlatformAdmin();
  const r = await updatePenaltyVersion(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function removePenaltyVersion(id: string) {
  const admin = await requirePlatformAdmin();
  const r = await deletePenaltyVersion(admin.id, id);
  if (r.ok) done();
  return r;
}
