"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { removeModuleTax, saveModuleTax } from "@/lib/compliance/module-tax-admin";
import type { ModuleTaxChoice } from "@/lib/compliance/module-taxes";

// Applicable taxes, for the platform administrator. Every action checks for one first; nothing here is scoped to an organization.

const done = () => revalidatePath("/admin/compliance", "layout");

export async function saveApplicableTax(input: { countryCode: string; moduleKey: string; taxTypeKey: string } & ModuleTaxChoice) {
  const admin = await requirePlatformAdmin();
  const r = await saveModuleTax(admin.id, input);
  if (r.ok) done();
  return r;
}

export async function removeApplicableTax(input: { countryCode: string; moduleKey: string; taxTypeKey: string }) {
  const admin = await requirePlatformAdmin();
  const r = await removeModuleTax(admin.id, input);
  if (r.ok) done();
  return r;
}
