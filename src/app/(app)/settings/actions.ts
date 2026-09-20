"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { INVOICE_NUMBER_FORMATS } from "@/lib/invoice-number";
import { logAuditEvent } from "@/lib/audit";
import { saveCompanyProfile } from "@/lib/company-profile";

export async function updateCompanyDetails(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  // One shared writer, so Settings and Compliance > Company Details can never disagree.
  await saveCompanyProfile(session.tenantId, session.userId, {
    companyName: String(formData.get("companyName") ?? ""),
    industry: String(formData.get("industry") ?? ""),
    baseCurrency: String(formData.get("baseCurrency") ?? "").trim() || "NPR",
    companyRegistrationNumber: String(formData.get("companyRegistrationNumber") ?? ""),
    panVatNumber: String(formData.get("panVatNumber") ?? ""),
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/compliance");
}

export async function updateOtherSettings(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const vatRate = String(formData.get("vatRate") ?? "").trim();
  const vatRateNum = parseFloat(vatRate);
  if (!vatRate || Number.isNaN(vatRateNum) || vatRateNum < 0 || vatRateNum > 100) {
    throw new Error("VAT rate must be a number between 0 and 100");
  }

  const tdsRate = String(formData.get("tdsRate") ?? "").trim();
  const tdsRateNum = parseFloat(tdsRate);
  if (!tdsRate || Number.isNaN(tdsRateNum) || tdsRateNum < 0 || tdsRateNum > 100) {
    throw new Error("TDS rate must be a number between 0 and 100");
  }

  const invoicePrefix = String(formData.get("invoicePrefix") ?? "").trim();
  const invoiceSuffix = String(formData.get("invoiceSuffix") ?? "").trim();
  const invoiceNumberFormat = String(formData.get("invoiceNumberFormat") ?? "prefix-number-suffix").trim();
  if (!INVOICE_NUMBER_FORMATS.some((f) => f.value === invoiceNumberFormat)) {
    throw new Error("Invalid invoice number format");
  }

  await db
    .update(tenants)
    .set({
      vatRate: vatRateNum.toFixed(2),
      tdsRate: tdsRateNum.toFixed(2),
      invoicePrefix: invoicePrefix || null,
      invoiceSuffix: invoiceSuffix || null,
      invoiceNumberFormat,
    })
    .where(eq(tenants.id, session.tenantId));

  revalidatePath("/settings");
  revalidatePath("/sales");
}

export async function updatePaymentNumbering(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const paymentNumberMode = String(formData.get("paymentNumberMode") ?? "single").trim();
  if (paymentNumberMode !== "single" && paymentNumberMode !== "split") {
    throw new Error("Invalid payment numbering mode");
  }
  const paymentNumberFormat = String(formData.get("paymentNumberFormat") ?? "prefix-number-suffix").trim();
  if (!INVOICE_NUMBER_FORMATS.some((f) => f.value === paymentNumberFormat)) {
    throw new Error("Invalid payment number format");
  }

  await db
    .update(tenants)
    .set({
      paymentNumberMode,
      paymentNumberFormat,
      paymentPrefix: String(formData.get("paymentPrefix") ?? "").trim() || null,
      paymentSuffix: String(formData.get("paymentSuffix") ?? "").trim() || null,
      receiptPrefix: String(formData.get("receiptPrefix") ?? "").trim() || null,
      receiptSuffix: String(formData.get("receiptSuffix") ?? "").trim() || null,
    })
    .where(eq(tenants.id, session.tenantId));

  revalidatePath("/settings");
  revalidatePath("/payments");
}

export async function updateCalendarSystem(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const calendarSystem = String(formData.get("calendarSystem") ?? "AD");
  if (calendarSystem !== "AD" && calendarSystem !== "BS") throw new Error("Invalid calendar");
  if (calendarSystem === session.calendar) return;

  await db.update(tenants).set({ calendarSystem }).where(eq(tenants.id, session.tenantId));
  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "calendar_changed",
    entityType: "organization",
    entityId: session.tenantId,
    before: { calendarSystem: session.calendar },
    after: { calendarSystem },
  });

  // Every page shows dates through the organization's calendar.
  revalidatePath("/", "layout");
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
