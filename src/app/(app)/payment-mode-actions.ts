"use server";

import { requireTenantSession, can } from "@/lib/session";
import { listModeOptions } from "@/lib/payment-modes";

// The payment modes with their accounts, for the payment pickers on every screen that records money in or out. Anyone who can
// record a transaction in one of those modules may see them (they are the choices on the form, nothing more).
const MODULES = ["sales", "purchases", "expenses", "payments", "assets", "compliance", "payroll"];

export async function getPaymentModeOptions() {
  const session = await requireTenantSession();
  if (!MODULES.some((m) => can(session, m, "create") || can(session, m, "edit"))) throw new Error("Not permitted");
  return listModeOptions(session.tenantId);
}
