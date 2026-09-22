"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceAuthorities, complianceTaxTypes, tenantTaxRegistrations, tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { validateADDate } from "@/lib/calendar";
import { logAuditEvent } from "@/lib/audit";
import { generateObligations } from "@/lib/compliance/engine/generate";

export type RegistrationStatus = "active" | "inactive" | "suspended" | "deregistered";
const STATUSES: RegistrationStatus[] = ["active", "inactive", "suspended", "deregistered"];

// Only VAT's filing period varies by organization today. NOTE: the requirement templates only have a confirmed
// due-date rule for "monthly" — choosing "quarterly" here is captured but does not yet change the generated VAT
// deadlines (see lib/compliance/config/nepal.ts). It's stored regardless so the setting isn't lost once that rule
// is added, and the schema never has to change for it.
export type FilingFrequency = "monthly" | "quarterly";
const FILING_FREQUENCIES: FilingFrequency[] = ["monthly", "quarterly"];
const FILING_FREQUENCY_TAX_TYPES = ["vat"];

export async function listTaxRegistrations() {
  const session = await requireTenantSession();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");

  const [taxTypes, authorities, rows] = await Promise.all([
    db.select().from(complianceTaxTypes).where(and(eq(complianceTaxTypes.countryCode, tenant.countryCode), eq(complianceTaxTypes.isRegistrable, true), eq(complianceTaxTypes.isActive, true))).orderBy(asc(complianceTaxTypes.sortOrder)),
    db.select().from(complianceAuthorities).where(eq(complianceAuthorities.countryCode, tenant.countryCode)),
    db.select().from(tenantTaxRegistrations).where(eq(tenantTaxRegistrations.tenantId, session.tenantId)),
  ]);
  const typeByKey = new Map(taxTypes.map((t) => [t.key, t]));
  const authorityName = new Map(authorities.map((a) => [a.key, a.name]));

  // Only registrations the organization actually holds are listed — a type it isn't registered for stays out of the way.
  const held = rows
    .filter((r) => typeByKey.has(r.taxTypeKey))
    .map((r) => {
      const type = typeByKey.get(r.taxTypeKey)!;
      const shared = type.numberSource === "company_pan_vat";
      return {
        id: r.id,
        taxTypeKey: r.taxTypeKey,
        taxTypeName: type.name,
        // PAN and VAT share the organization's single PAN/VAT number.
        number: shared ? tenant.panVatNumber ?? "" : r.registrationNumber ?? "",
        numberIsShared: shared,
        registrationDate: r.registrationDate ?? "",
        effectiveDate: r.effectiveDate ?? "",
        deregistrationDate: r.deregistrationDate ?? "",
        status: r.status as RegistrationStatus,
        filingFrequency: (r.filingFrequency ?? "") as FilingFrequency | "",
        filingFrequencyEffectiveFrom: r.filingFrequencyEffectiveFrom ?? "",
        authorityKey: r.authorityKey ?? type.authorityKey ?? "",
        authorityName: authorityName.get(r.authorityKey ?? type.authorityKey ?? "") ?? "",
        supportingDocument: r.supportingDocument ?? "",
        notes: r.notes ?? "",
      };
    });

  const heldKeys = new Set(held.map((h) => h.taxTypeKey));
  return {
    canEdit: can(session, "compliance", "edit"),
    registrations: held,
    addable: taxTypes.filter((t) => !heldKeys.has(t.key)).map((t) => ({ key: t.key, name: t.name, numberIsShared: t.numberSource === "company_pan_vat", authorityKey: t.authorityKey ?? "" })),
    authorities: authorities.map((a) => ({ key: a.key, name: a.name })),
    statuses: STATUSES,
    filingFrequencies: FILING_FREQUENCIES,
    filingFrequencyTaxTypes: FILING_FREQUENCY_TAX_TYPES,
    hasPanVatNumber: Boolean(tenant.panVatNumber?.trim()),
  };
}

export type RegistrationInput = {
  id?: string;
  taxTypeKey: string;
  registrationNumber: string;
  registrationDate: string;
  effectiveDate: string;
  deregistrationDate: string;
  status: RegistrationStatus;
  filingFrequency: FilingFrequency | "";
  filingFrequencyEffectiveFrom: string;
  authorityKey: string;
  supportingDocument: string;
  notes: string;
};

export async function saveTaxRegistration(input: RegistrationInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", input.id ? "edit" : "create")) throw new Error("Not permitted");
  if (!STATUSES.includes(input.status)) throw new Error("Unknown status");
  for (const [label, v] of [["registration", input.registrationDate], ["effective", input.effectiveDate], ["deregistration", input.deregistrationDate], ["filing basis effective", input.filingFrequencyEffectiveFrom]] as const) {
    if (v && !validateADDate(v)) throw new Error(`Enter a valid ${label} date`);
  }
  if (input.status === "deregistered" && !input.deregistrationDate) throw new Error("Enter the deregistration date");
  if (input.filingFrequency && !FILING_FREQUENCIES.includes(input.filingFrequency)) throw new Error("Unknown filing basis");
  if (input.filingFrequency && !input.filingFrequencyEffectiveFrom) throw new Error("Enter when the new filing basis takes effect");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const [type] = await db
    .select()
    .from(complianceTaxTypes)
    .where(and(eq(complianceTaxTypes.countryCode, tenant.countryCode), eq(complianceTaxTypes.key, input.taxTypeKey), eq(complianceTaxTypes.isRegistrable, true)))
    .limit(1);
  if (!type) throw new Error("This registration type is not available for your country");

  const shared = type.numberSource === "company_pan_vat";
  if (shared && !tenant.panVatNumber?.trim()) throw new Error("Add your PAN / VAT number in Company Details first");

  const values = {
    registrationNumber: shared ? null : input.registrationNumber.trim() || null,
    registrationDate: input.registrationDate || null,
    effectiveDate: input.effectiveDate || null,
    deregistrationDate: input.status === "deregistered" ? input.deregistrationDate : null,
    status: input.status,
    filingFrequency: FILING_FREQUENCY_TAX_TYPES.includes(input.taxTypeKey) ? input.filingFrequency || null : null,
    filingFrequencyEffectiveFrom: FILING_FREQUENCY_TAX_TYPES.includes(input.taxTypeKey) ? input.filingFrequencyEffectiveFrom || null : null,
    authorityKey: input.authorityKey || null,
    supportingDocument: input.supportingDocument.trim() || null,
    notes: input.notes.trim() || null,
  };

  if (input.id) {
    const [before] = await db
      .select()
      .from(tenantTaxRegistrations)
      .where(and(eq(tenantTaxRegistrations.id, input.id), eq(tenantTaxRegistrations.tenantId, session.tenantId)))
      .limit(1);
    if (!before) throw new Error("Registration not found");
    await db.update(tenantTaxRegistrations).set({ ...values, updatedAt: new Date() }).where(eq(tenantTaxRegistrations.id, before.id));
    // The history of a registration is its audit trail: nothing is overwritten without a before/after record.
    await logAuditEvent({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "tax_registration_changed",
      entityType: "tax_registration",
      entityId: before.id,
      before: { taxType: before.taxTypeKey, status: before.status, registrationNumber: before.registrationNumber, effectiveDate: before.effectiveDate, deregistrationDate: before.deregistrationDate },
      after: { taxType: input.taxTypeKey, ...values },
    });
  } else {
    const [dup] = await db
      .select({ id: tenantTaxRegistrations.id })
      .from(tenantTaxRegistrations)
      .where(and(eq(tenantTaxRegistrations.tenantId, session.tenantId), eq(tenantTaxRegistrations.taxTypeKey, input.taxTypeKey)))
      .limit(1);
    if (dup) throw new Error("This registration already exists — edit it instead");
    const [created] = await db.insert(tenantTaxRegistrations).values({ tenantId: session.tenantId, taxTypeKey: input.taxTypeKey, ...values }).returning();
    await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "tax_registration_added", entityType: "tax_registration", entityId: created.id, after: { taxType: input.taxTypeKey, ...values } });
  }

  // Registrations decide which requirements apply (e.g. VAT registered => VAT returns).
  try {
    await generateObligations(session.tenantId);
  } catch (e) {
    console.error("compliance generation failed", e);
  }
  revalidatePath("/compliance", "layout");
}
