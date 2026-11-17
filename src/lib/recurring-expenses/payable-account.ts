import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, recurringExpenses } from "@/db/schema";
import { findControlAccount, createSubAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";

// Where each occurrence of a recurring expense is owed until it is paid. With a supplier, the supplier's own account (so it shows in their history and
// statement). Without one, the recurring expense's own liability account ("Netflix subscription payable") under the group Recurring Payable, so what is
// owed on each subscription can be seen, and settled, on its own.

export const RECURRING_PAYABLE_CODE = "2345";

/** The group the recurring expenses' own accounts sit under; made the first time one is needed. */
export async function getOrCreateRecurringPayableGroup(tenantId: string) {
  const existing = await findControlAccount(tenantId, [RECURRING_PAYABLE_CODE], "Recurring Payable");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: RECURRING_PAYABLE_CODE, name: "Recurring Payable", category: "liability", subCategory: "Current liabilities" })
    .returning();
  return created;
}

/** The name of a recurring expense's own account. */
export const recurringPayableName = (expenseName: string) => `${expenseName.trim()} payable`;

/** The recurring expense's own account, made (and remembered on it) the first time it is needed. */
export async function ensureRecurringPayableAccountId(tenantId: string, template: { id: string; expenseName: string; payableAccountId: string | null }): Promise<string> {
  if (template.payableAccountId) return template.payableAccountId;
  const group = await getOrCreateRecurringPayableGroup(tenantId);
  const account = await createSubAccount(tenantId, group, recurringPayableName(template.expenseName));
  await db.update(recurringExpenses).set({ payableAccountId: account.id }).where(and(eq(recurringExpenses.id, template.id), eq(recurringExpenses.tenantId, tenantId)));
  return account.id;
}

/** The account an occurrence is owed on: the supplier's own account when it has a supplier, otherwise the recurring expense's own account. */
export async function recurringOwedAccountId(tenantId: string, template: { id: string; expenseName: string; vendorId: string | null; payableAccountId: string | null }): Promise<string> {
  return template.vendorId ? getOrCreateSupplierPayableAccountId(tenantId, template.vendorId) : ensureRecurringPayableAccountId(tenantId, template);
}

/** Keeps the account's name in step with the recurring expense when it is renamed. */
export async function renameRecurringPayableAccount(tenantId: string, accountId: string | null, expenseName: string) {
  if (!accountId) return;
  await db.update(accounts).set({ name: recurringPayableName(expenseName) }).where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId)));
}
