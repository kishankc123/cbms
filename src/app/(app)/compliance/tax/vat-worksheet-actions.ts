"use server";

import { requireTenantSession, can } from "@/lib/session";
import { getVatWorksheet } from "@/lib/compliance/vat-worksheet";

// fiscalYearKey is the start date (AD) of the year the person picked in the drop-down; blank = the current year.
export async function getVatWorksheetView(fiscalYearKey?: string | null) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  return getVatWorksheet(session.tenantId, typeof fiscalYearKey === "string" ? fiscalYearKey : null);
}
