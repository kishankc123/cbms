"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export async function updateCompanyDetails(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName) throw new Error("Company name is required");
  const industry = String(formData.get("industry") ?? "").trim();
  const baseCurrency = String(formData.get("baseCurrency") ?? "").trim() || "NPR";
  const taxRegistrationNumber = String(formData.get("taxRegistrationNumber") ?? "").trim();

  await db
    .update(tenants)
    .set({
      companyName,
      industry: industry || null,
      baseCurrency,
      taxRegistrationNumber: taxRegistrationNumber || null,
    })
    .where(eq(tenants.id, session.tenantId));

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function updateFiscalYearDates(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const fiscalYearLabel = String(formData.get("fiscalYearLabel") ?? "").trim();
  if (!fiscalYearLabel) throw new Error("Fiscal year is required");
  const fiscalYearStartDate = String(formData.get("fiscalYearStartDate") ?? "").trim();
  const fiscalYearEndDate = String(formData.get("fiscalYearEndDate") ?? "").trim();
  if (fiscalYearStartDate && fiscalYearEndDate && fiscalYearStartDate > fiscalYearEndDate) {
    throw new Error("Fiscal year beginning date must be before the ending date");
  }

  await db
    .update(tenants)
    .set({
      fiscalYearLabel,
      fiscalYearStartDate: fiscalYearStartDate || null,
      fiscalYearEndDate: fiscalYearEndDate || null,
    })
    .where(eq(tenants.id, session.tenantId));

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
