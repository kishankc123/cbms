"use server";

import { requireTenantSession, can } from "@/lib/session";
import { getVatWorksheet } from "@/lib/compliance/vat-worksheet";

export async function getVatWorksheetView() {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  return getVatWorksheet(session.tenantId);
}
