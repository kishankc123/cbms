import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts } from "@/db/schema";

type Account = typeof accounts.$inferSelect;

// A chart account under Bank (code 1010...) is a bank account. Bank Reconciliation works on rows of `bank_accounts`, so a
// new Bank sub-account gets its linked row at once. The details (bank name, number, branch) are filled in later at
// Bank Reconciliation -> Setup; the opening balance is entered there too, which posts it to the ledger.
export const isBankLedgerCode = (code: string) => code.startsWith("1010") && code !== "1010";

export async function ensureBankAccountFor(tenantId: string, account: Pick<Account, "id" | "code" | "name" | "category">) {
  if (account.category !== "asset" || !isBankLedgerCode(account.code)) return null;
  const [existing] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.chartOfAccountsLink, account.id)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(bankAccounts)
    .values({ tenantId, bankName: account.name, accountName: account.name, chartOfAccountsLink: account.id })
    .returning({ id: bankAccounts.id });
  return created.id;
}
