"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { loadOpeningSheet, saveOpeningSheet } from "@/lib/ledger/opening-ledger";

export async function getOpeningSheet() {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  return loadOpeningSheet(session.tenantId);
}

export async function saveOpeningBalances(input: { date: string; netDebits: Record<string, number> }) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "edit")) throw new Error("Not permitted");
  const saved = await saveOpeningSheet(session.tenantId, session.userId, input);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "opening_balances_saved", entityType: "opening_balances", entityId: session.tenantId, after: saved });
  for (const path of ["/settings/opening-balances", "/chart-of-accounts", "/journal"]) revalidatePath(path);
}
