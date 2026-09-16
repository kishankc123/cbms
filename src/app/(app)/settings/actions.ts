"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export async function updateTenantSettings(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName) throw new Error("Company name is required");
  const industry = String(formData.get("industry") ?? "").trim();
  const fiscalYearStartMonth = parseInt(String(formData.get("fiscalYearStartMonth") ?? "1"), 10) || 1;
  const baseCurrency = String(formData.get("baseCurrency") ?? "").trim() || "NPR";
  const taxRegistrationNumber = String(formData.get("taxRegistrationNumber") ?? "").trim();

  await db
    .update(tenants)
    .set({
      companyName,
      industry: industry || null,
      fiscalYearStartMonth,
      baseCurrency,
      taxRegistrationNumber: taxRegistrationNumber || null,
    })
    .where(eq(tenants.id, session.tenantId));

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
