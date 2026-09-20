"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, complianceEntityTypes, tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { validateADDate } from "@/lib/calendar";
import { COMPANY_STATUSES, saveCompanyProfile, type CompanyStatus } from "@/lib/company-profile";
import { generateObligations } from "@/lib/compliance/engine/generate";

export async function getCompanyDetails() {
  const session = await requireTenantSession();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!t) throw new Error("Organization not found");

  const [countries, entityTypes] = await Promise.all([
    db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name)),
    db
      .select({ key: complianceEntityTypes.key, name: complianceEntityTypes.name })
      .from(complianceEntityTypes)
      .where(and(eq(complianceEntityTypes.countryCode, t.countryCode), eq(complianceEntityTypes.isActive, true)))
      .orderBy(asc(complianceEntityTypes.sortOrder)),
  ]);

  return {
    canEdit: can(session, "compliance", "edit"),
    countries,
    entityTypes,
    statuses: [...COMPANY_STATUSES],
    values: {
      companyName: t.companyName,
      tradingName: t.tradingName ?? "",
      companyRegistrationNumber: t.companyRegistrationNumber ?? "",
      registrationDate: t.registrationDate ?? "",
      panVatNumber: t.panVatNumber ?? "",
      registeredOffice: t.registeredOffice ?? "",
      businessAddress: t.address ?? "",
      natureOfBusiness: t.industry ?? "",
      companyStatus: (COMPANY_STATUSES as readonly string[]).includes(t.companyStatus) ? (t.companyStatus as CompanyStatus) : "active",
      companyStatusNote: t.companyStatusNote ?? "",
      countryCode: t.countryCode,
      entityType: t.entityType ?? "",
      financialYear: t.fiscalYearLabel ?? "",
      fiscalYearStartDate: t.fiscalYearStartDate ?? "",
      fiscalYearEndDate: t.fiscalYearEndDate ?? "",
    },
  };
}

export type CompanyDetailsInput = {
  companyName: string;
  tradingName: string;
  companyRegistrationNumber: string;
  registrationDate: string;
  panVatNumber: string;
  registeredOffice: string;
  businessAddress: string;
  natureOfBusiness: string;
  companyStatus: CompanyStatus;
  companyStatusNote: string;
  countryCode: string;
  entityType: string;
};

export async function saveCompanyDetails(input: CompanyDetailsInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");
  if (input.registrationDate && !validateADDate(input.registrationDate)) throw new Error("Enter a valid registration date");

  const [country] = await db.select().from(complianceCountries).where(and(eq(complianceCountries.code, input.countryCode), eq(complianceCountries.isActive, true))).limit(1);
  if (!country) throw new Error("That country is not configured for compliance");
  if (input.entityType) {
    const [type] = await db
      .select({ key: complianceEntityTypes.key })
      .from(complianceEntityTypes)
      .where(and(eq(complianceEntityTypes.countryCode, input.countryCode), eq(complianceEntityTypes.key, input.entityType), eq(complianceEntityTypes.isActive, true)))
      .limit(1);
    if (!type) throw new Error("That entity type does not exist for the selected country");
  }
  if (input.companyStatus === "other" && !input.companyStatusNote.trim()) throw new Error("Describe the company status");

  await saveCompanyProfile(session.tenantId, session.userId, {
    companyName: input.companyName,
    tradingName: input.tradingName,
    companyRegistrationNumber: input.companyRegistrationNumber,
    registrationDate: input.registrationDate || null,
    panVatNumber: input.panVatNumber,
    registeredOffice: input.registeredOffice,
    address: input.businessAddress,
    industry: input.natureOfBusiness,
    companyStatus: input.companyStatus,
    companyStatusNote: input.companyStatus === "other" ? input.companyStatusNote : null,
    countryCode: input.countryCode,
    entityType: input.entityType || null,
  });

  // The entity type and registrations decide which requirements apply.
  try {
    await generateObligations(session.tenantId);
  } catch (e) {
    console.error("compliance generation failed", e);
  }
  revalidatePath("/compliance", "layout");
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
