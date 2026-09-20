"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { ChartError, createAccountEntry, createSubGroupEntry, deleteAccountEntry, updateAccountEntry } from "@/lib/ledger/chart";

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

async function guard(action: "create" | "edit" | "delete") {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", action)) throw new Error("Not permitted");
  return session;
}

export async function createAccount(input: { code: string; name: string; subCategory: string }): Promise<ChartResult> {
  return run(async () => {
    const s = await guard("create");
    await createAccountEntry(s.tenantId, s.userId, input);
  });
}

export async function createSubGroupAccount(input: { parentAccountId: string; name: string }): Promise<ChartResult> {
  return run(async () => {
    const s = await guard("create");
    await createSubGroupEntry(s.tenantId, s.userId, input);
  });
}

export async function updateAccount(input: { id: string; name: string; isActive: boolean; subCategory?: string | null }): Promise<ChartResult> {
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
