"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { ChartError, createAccountEntry, createSubGroupEntry, deleteAccountEntry, updateAccountEntry } from "@/lib/ledger/chart";
import { listTdsHeads, type TdsHead } from "@/lib/ledger/tds-links";

export type ChartResult = { ok: true } | { ok: false; error: string };

// Rule violations come back as a message the form can show; anything unexpected still throws.
async function run(fn: () => Promise<void>): Promise<ChartResult> {
  try {
    await fn();
    revalidatePath("/chart-of-accounts", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ChartError) return { ok: false, error: e.message };
    if (e instanceof Error && e.message === "Not permitted") return { ok: false, error: "You don't have permission to do that." };
    throw e;
  }
}

async function guard(action: "view" | "create" | "edit" | "delete") {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", action)) throw new Error("Not permitted");
  return session;
}

/** The TDS headings of this organization's country, with today's rate, for the "subject to TDS?" question. */
export async function getTdsHeads(): Promise<TdsHead[]> {
  const s = await guard("view");
  return listTdsHeads(s.tenantId);
}

/** One way to add an account: a new group (with its own code) or a sub-group inside an existing group (code given automatically). */
export async function addAccount(input: { parentAccountId: string | null; code: string; name: string; subCategory: string; tdsHeadKey: string | null }): Promise<ChartResult> {
  return run(async () => {
    const s = await guard("create");
    if (input.parentAccountId) await createSubGroupEntry(s.tenantId, s.userId, { parentAccountId: input.parentAccountId, name: input.name, tdsHeadKey: input.tdsHeadKey });
    else await createAccountEntry(s.tenantId, s.userId, input);
  });
}

export async function updateAccount(input: { id: string; name: string; isActive: boolean; subCategory?: string | null; tdsHeadKey?: string | null }): Promise<ChartResult> {
  return run(async () => {
    const s = await guard("edit");
    await updateAccountEntry(s.tenantId, s.userId, input);
  });
}

export async function deleteAccount(id: string): Promise<ChartResult> {
  return run(async () => {
    const s = await guard("delete");
    await deleteAccountEntry(s.tenantId, s.userId, id);
  });
}
