"use server";

import { revalidatePath } from "next/cache";
import { can, requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { buildStatementTemplate } from "@/lib/suppliers/statement-template";
import type { ColumnMapping } from "@/lib/banking/normalize-rows";
import type { Orientation } from "@/lib/suppliers/reconcile-rules";
import {
  confirmMatch,
  createReconciliation,
  deleteReconciliation,
  manualMatch,
  previewStatement,
  ReconError,
  rematch,
  reopen,
  setFlag,
  signOff,
  unmatch,
  type CreateInput,
  type Reason,
} from "@/lib/suppliers/reconcile";

// Reconciling supplier statements. It follows the Purchases permissions: whoever can see supplier ledgers can reconcile them. Every action checks first;
// the work is in lib/suppliers/reconcile.ts, and nothing here posts to the books.

async function guard(action: "view" | "create" | "edit" | "delete") {
  const session = await requireTenantSession();
  if (!can(session, "purchases", action)) throw new Error("Not permitted");
  return session;
}

/** The sheet to send a supplier who asks what layout we want their statement in. */
export async function downloadStatementTemplateAction(): Promise<{ fileName: string; base64: string }> {
  await guard("view");
  return { fileName: "supplier-statement-template.xlsx", base64: buildStatementTemplate() };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ReconError) throw new Error(e.message);
    throw e;
  }
}

function refresh(id?: string) {
  revalidatePath("/suppliers/reconcile");
  if (id) revalidatePath(`/suppliers/reconcile/${id}`);
}

export async function previewStatementAction(input: { vendorId: string; from: string; to: string; fileName: string; base64: string; mapping?: ColumnMapping | null; orientation?: Orientation | null }) {
  const session = await guard("create");
  return run(() => previewStatement(session.tenantId, input));
}

export async function createReconciliationAction(input: CreateInput) {
  const session = await guard("create");
  const recon = await run(() => createReconciliation(session.tenantId, session.userId, input));
  refresh();
  return recon.id;
}

export async function rematchAction(input: { reconId: string }) {
  const session = await guard("edit");
  await run(() => rematch(session.tenantId, session.userId, input.reconId));
  refresh(input.reconId);
}

export async function confirmMatchAction(input: { reconId: string; matchId: string }) {
  const session = await guard("edit");
  await run(() => confirmMatch(session.tenantId, session.userId, input.matchId));
  refresh(input.reconId);
}

export async function unmatchAction(input: { reconId: string; matchId: string }) {
  const session = await guard("edit");
  await run(() => unmatch(session.tenantId, session.userId, input.matchId));
  refresh(input.reconId);
}

export async function manualMatchAction(input: { reconId: string; theirLineIds: string[]; entryIds: string[] }) {
  const session = await guard("edit");
  await run(() => manualMatch(session.tenantId, session.userId, input.reconId, input.theirLineIds, input.entryIds));
  refresh(input.reconId);
}

export async function setFlagAction(input: { reconId: string; theirLineId?: string; entryId?: string; reason: Reason | null; note?: string }) {
  const session = await guard("edit");
  await run(() => setFlag(session.tenantId, session.userId, input.reconId, { theirLineId: input.theirLineId, entryId: input.entryId }, input.reason, input.note ?? ""));
  refresh(input.reconId);
}

export async function signOffAction(input: { reconId: string; notes?: string }) {
  const session = await guard("edit");
  await run(() => signOff(session.tenantId, session.userId, input.reconId, input.notes ?? ""));
  refresh(input.reconId);
}

export async function reopenAction(input: { reconId: string }) {
  const session = await guard("edit");
  if (!isOrgAdmin(session.role)) throw new Error("Only an admin can reopen a signed-off reconciliation");
  await run(() => reopen(session.tenantId, session.userId, input.reconId));
  refresh(input.reconId);
}

export async function deleteReconciliationAction(input: { reconId: string }) {
  const session = await guard("delete");
  await run(() => deleteReconciliation(session.tenantId, session.userId, input.reconId));
  refresh();
}
