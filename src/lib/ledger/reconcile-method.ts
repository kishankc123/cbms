import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankReconciliations } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { isBankLedgerCode, reconcileMethodOf, type ReconcileMethod } from "./cash-reconcile-rules";

/**
 * Chooses how a bank account is reconciled: against its uploaded statement, or by ticking the entries and confirming the closing balance (for a person who
 * has no statement to upload). Cash and wallet accounts always tick, so only a bank account can change. Nothing already reconciled moves: the entries
 * matched to a statement stay reconciled, and the ticking screen takes them into its opening figure; the ticked ones stay reconciled when it goes back.
 * It can't change while a statement reconciliation is half done, since that work would be left behind.
 */
export async function setReconcileMethod(tenantId: string, userId: string, bankAccountId: string, method: ReconcileMethod): Promise<{ changed: boolean; method: ReconcileMethod }> {
  if (method !== "statement" && method !== "ticking") throw new Error("Choose how this account is reconciled.");
  const [row] = await db
    .select({ id: bankAccounts.id, name: bankAccounts.accountName, code: accounts.code, stored: bankAccounts.reconcileMethod })
    .from(bankAccounts)
    .innerJoin(accounts, eq(accounts.id, bankAccounts.chartOfAccountsLink))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, tenantId), eq(accounts.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new Error("That account was not found.");
  if (!isBankLedgerCode(row.code)) throw new Error("Cash and wallet accounts are always reconciled by ticking the entries. Only a bank account can use a statement.");
  const before = reconcileMethodOf(row.code, row.stored);
  if (before === method) return { changed: false, method };

  const [open] = await db
    .select({ id: bankReconciliations.id })
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.tenantId, tenantId), eq(bankReconciliations.bankAccountId, bankAccountId), eq(bankReconciliations.status, "in_progress")))
    .limit(1);
  if (open) throw new Error("A reconciliation against the statement is still in progress for this account. Finish it or reopen it first, then change the method.");

  await db.update(bankAccounts).set({ reconcileMethod: method }).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, tenantId)));
  await logAuditEvent({
    tenantId,
    userId,
    action: "reconcile_method_changed",
    entityType: "bank_account",
    entityId: bankAccountId,
    before: { account: row.name, method: before },
    after: { account: row.name, method },
  });
  return { changed: true, method };
}
