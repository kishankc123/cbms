"use server";

import { requireTenantSession, can } from "@/lib/session";
import { journalEntryDetail } from "@/lib/ledger/entry-detail";
import { entryInScope, SCOPE_MODULE, type EntryScope } from "@/lib/ledger/entry-access";

// The transaction pop-up on the ledger-style reports. The report says which kind of report it is (its scope); the person needs
// that report's own permission, and the entry has to be one that report is about.
export async function getReportEntry(entryId: string, scope: EntryScope) {
  const session = await requireTenantSession();
  const requiredModule = SCOPE_MODULE[scope];
  if (!requiredModule || !can(session, requiredModule, "view")) throw new Error("Not permitted");
  if (!(await entryInScope(session.tenantId, entryId, scope))) return null;
  return journalEntryDetail(session.tenantId, entryId);
}
