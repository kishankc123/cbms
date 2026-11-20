"use server";

import { revalidatePath } from "next/cache";
import { can, requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import type { ExpenseInput } from "@/lib/expenses/expense-records";
import { CashReconError, cashWorkspace, explainExcess, explainWithExpense, getCashLock, reopenCashBackTo, signOffCash, type CashLockInfo, type CashWorkspace, type SignOffInput } from "@/lib/ledger/cash-reconcile";

// Reconciling a cash account. Whoever can reconcile the bank can reconcile cash. Every action checks first; the work is in lib/ledger/cash-reconcile.ts.

async function guard(action: "view" | "edit") {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", action)) throw new Error("Not permitted");
  return session;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CashReconError) throw new Error(e.message);
    throw e;
  }
}

function refresh(bankAccountId?: string) {
  revalidatePath("/bank-reconciliation");
  if (bankAccountId) revalidatePath(`/bank-reconciliation/${bankAccountId}/cash`);
  revalidatePath("/reports/daybook");
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}

/** The entries to reconcile as at another date (the page loads the first date itself). */
export async function getCashWorkspaceAction(input: { bankAccountId: string; asOf: string }): Promise<CashWorkspace> {
  const session = await guard("view");
  return run(() => cashWorkspace(session.tenantId, input.bankAccountId, input.asOf));
}

export async function signOffCashAction(input: SignOffInput) {
  const session = await guard("edit");
  const r = await run(() => signOffCash(session.tenantId, session.userId, input));
  refresh(input.bankAccountId);
  return r;
}

/** Whether a document's cash line is locked by a reconciliation, for the banner on its form. */
export async function getCashLockAction(input: { sourceId: string }): Promise<CashLockInfo | null> {
  const session = await requireTenantSession();
  const lock = await getCashLock(session.tenantId, input.sourceId);
  return lock ? { ...lock, canUnlock: isOrgAdmin(session.role) && can(session, "bank_reconciliation", "edit") } : null;
}

/** Unlocks by reopening the reconciliation given and every later one of that account. Owner or admin only. */
export async function reopenCashReconciliationAction(input: { reconId: string; bankAccountId: string; reason: string }) {
  const session = await guard("edit");
  if (!isOrgAdmin(session.role)) throw new Error("Only an admin can unlock a reconciled cash entry");
  const r = await run(() => reopenCashBackTo(session.tenantId, session.userId, input.reconId, input.reason));
  refresh(input.bankAccountId);
  revalidatePath("/expenses");
  revalidatePath("/purchases");
  revalidatePath("/sales");
  revalidatePath("/payments");
  return r;
}

/** A shortage found to be an expense: recorded as an expense settled from Cash short and excess. */
export async function explainShortageAction(input: { reconId: string; bankAccountId: string; expense: ExpenseInput; amount: number }) {
  const session = await guard("edit");
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  const r = await run(() => explainWithExpense({ tenantId: session.tenantId, userId: session.userId }, input.reconId, input.expense, input.amount));
  refresh(input.bankAccountId);
  return { warnings: r.warnings, expenseNumber: r.expenseNumber };
}

/** An excess found to be cash that was received and not recorded. */
export async function explainExcessAction(input: { reconId: string; bankAccountId: string; accountId: string; amount: number; date: string; note: string }) {
  const session = await guard("edit");
  await run(() => explainExcess({ tenantId: session.tenantId, userId: session.userId }, input.reconId, input));
  refresh(input.bankAccountId);
}
