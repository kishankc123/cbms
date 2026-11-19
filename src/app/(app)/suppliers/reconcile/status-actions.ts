"use server";

import { can, requireTenantSession } from "@/lib/session";
import { formatDate } from "@/lib/calendar";
import { reconciledWarning, statementRows } from "@/lib/suppliers/reconcile-status";

// Read-only helpers for the supplier profile and for the screens that change a bill, expense or payment.

/** The supplier's uploaded statement, each row with what it was set against in the books. */
export async function getStatementRowsAction(input: { reconId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "view")) throw new Error("Not permitted");
  return statementRows(session.tenantId, input.reconId);
}

const NOUN = { bill: "bill", expense: "expense", payment: "payment" } as const;

/**
 * A sentence for the person about to change (or void) a bill, expense or payment that sits inside a period already reconciled with the supplier, or null when
 * it doesn't. It only warns; the change is still theirs to make.
 */
export async function getReconciledWarningAction(input: { kind: "bill" | "expense" | "payment"; id: string }): Promise<string | null> {
  const session = await requireTenantSession();
  const area = input.kind === "bill" ? "purchases" : input.kind === "expense" ? "expenses" : "payments";
  if (!can(session, area, "view")) return null;
  const w = await reconciledWarning(session.tenantId, input.kind, input.id);
  if (!w) return null;
  const when = (iso: string) => formatDate(iso, session.calendar, "long");
  return `This ${NOUN[input.kind]} is dated inside a period you reconciled with ${w.vendorName} (${when(w.from)} to ${when(w.to)}${w.signedOffAt ? `, signed off ${when(w.signedOffAt)}` : ""}). Changing it means your books will no longer agree with their statement for that period.`;
}
