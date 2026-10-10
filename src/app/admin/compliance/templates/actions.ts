"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { listTemplates, updateTemplate, type UpdateTemplateInput } from "@/lib/compliance/template-admin";

// Requirement templates, for the platform administrator. Every action checks for one first; a template is shared by every
// organization of its country.

export async function getTemplateAdminData(countryCode?: string) {
  await requirePlatformAdmin();
  const countries = await db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name));
  const country = countries.find((c) => c.code === countryCode) ?? countries[0] ?? null;
  return { countries, country, templates: country ? await listTemplates(country.code) : [] };
}
export type TemplateAdminData = Awaited<ReturnType<typeof getTemplateAdminData>>;

export async function saveTemplate(input: UpdateTemplateInput) {
  const admin = await requirePlatformAdmin();
  const r = await updateTemplate(admin.id, input);
  if (r.ok) {
    revalidatePath("/admin/compliance/templates");
    revalidatePath("/compliance", "layout");
  }
  return r;
}
