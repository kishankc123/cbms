import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { getAccountByRole } from "@/lib/compliance/tax-accounts";
import { RETIREMENT_ACCOUNTS, type RetirementAccountKey } from "./retirement-pay";

// What payroll still owes the retirement funds: the credit balance of each contribution payable account. Accounts are created the first time a payroll
// run posts to them, so one that does not exist yet simply owes nothing.

export const retirementRole = (key: RetirementAccountKey) => `payroll_retirement:${key}`;

/** The funds a remittance goes to, and which payable accounts it clears. The SSF office is paid in one go (employee share, employer share and gratuity). */
export const FUNDS = [
  { key: "ssf", name: "Social Security Fund (SSF)", accounts: ["employee_ssf", "employer_ssf", "gratuity"] as RetirementAccountKey[] },
  { key: "pf", name: "Provident fund (PF)", accounts: ["employee_pf", "employer_pf"] as RetirementAccountKey[] },
  { key: "cit", name: "Citizen Investment Trust (CIT)", accounts: ["cit"] as RetirementAccountKey[] },
] as const;
export type FundKey = (typeof FUNDS)[number]["key"];

export const accountLabel = (key: RetirementAccountKey) => RETIREMENT_ACCOUNTS[key];

/** What is still owed in each payable account (a credit balance), by account key. Missing accounts owe nothing. */
export async function retirementBalances(tenantId: string): Promise<Record<RetirementAccountKey, { accountId: string | null; owed: number }>> {
  const out = {} as Record<RetirementAccountKey, { accountId: string | null; owed: number }>;
  for (const key of Object.keys(RETIREMENT_ACCOUNTS) as RetirementAccountKey[]) {
    const account = await getAccountByRole(tenantId, retirementRole(key));
    if (!account) {
      out[key] = { accountId: null, owed: 0 };
      continue;
    }
    const [row] = await db
      .select({ v: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, account.id)));
    out[key] = { accountId: account.id, owed: Math.round(Number(row.v) * 100) / 100 };
  }
  return out;
}
