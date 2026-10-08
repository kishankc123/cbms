"use server";

import { requireTenantSession, can } from "@/lib/session";
import { journalEntryDetail } from "@/lib/ledger/entry-detail";

// The transaction pop-up on the Ledger report. Anyone who can see the ledger can see the entries behind it.
export async function getLedgerEntry(entryId: string) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  return journalEntryDetail(session.tenantId, entryId);
}
