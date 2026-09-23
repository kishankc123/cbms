"use server";

import { requireTenantSession } from "@/lib/session";
import { getVatWorksheet } from "@/lib/compliance/vat-worksheet";

export async function getVatWorksheetView() {
  const session = await requireTenantSession();
  return getVatWorksheet(session.tenantId);
}
