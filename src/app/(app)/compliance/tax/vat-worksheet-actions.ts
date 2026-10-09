"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getVatPeriodDetails } from "@/lib/compliance/vat-period-details";
import { discardVatWorksheetDraft, getVatWorksheetState, loadVatWorksheet, saveVatWorksheet } from "@/lib/compliance/vat-worksheet-store";

// yearKey is the start date (AD) of the fiscal year picked in the drop-down; blank = the current year. Seeing the worksheet needs
// compliance view; loading it from the books, saving it or discarding a loaded one needs compliance edit.

export async function getVatWorksheetView(yearKey?: string | null) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  return { canEdit: can(session, "compliance", "edit"), ...(await getVatWorksheetState(session.tenantId, typeof yearKey === "string" ? yearKey : null)) };
}

export async function loadVatWorksheetFromBooks(yearKey: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to load the worksheet." };
  try {
    await loadVatWorksheet(session.tenantId, session.userId, yearKey);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not load the worksheet." };
  }
}

export async function saveVatWorksheetDraft(yearKey: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to save the worksheet." };
  return saveVatWorksheet(session.tenantId, session.userId, yearKey);
}

export async function discardVatWorksheetLoad(yearKey: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to change the worksheet." };
  await discardVatWorksheetDraft(session.tenantId, yearKey);
  return { ok: true as const };
}

// The documents behind a month's Net sales and Net purchase (shown when the month is hovered). Needs compliance view.
export async function getVatPeriodDetailsView(obligationId: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  const [o] = await db
    .select({ periodStart: complianceObligations.periodStart, periodEnd: complianceObligations.periodEnd })
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, obligationId), eq(complianceObligations.tenantId, session.tenantId), eq(complianceObligations.taxTypeKey, "vat")))
    .limit(1);
  if (!o?.periodStart || !o.periodEnd) throw new Error("That VAT period was not found.");
  return getVatPeriodDetails(session.tenantId, o.periodStart, o.periodEnd);
}
