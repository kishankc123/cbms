import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { postJournalEntry, reverseLatestEntryForSource, type PostLineInput } from "./post";
import { getOrCreateBroughtForwardAccount } from "./control-accounts";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";

import { todayIso } from "@/lib/calendar";
export async function openingBalanceEntryDate(tenantId: string) {
  const [tenant] = await db
    .select({ openingDate: tenants.openingBalanceDate, fiscalYearStartDate: tenants.fiscalYearStartDate })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.openingDate || tenant?.fiscalYearStartDate || todayIso();
}

// The one place an opening entry is posted. Always reverses whatever was posted before for the same source first, so it is
// safe to call on every create/update (reversing a non-existent entry is a no-op); no lines means the balance is now nil.
export async function replaceOpeningEntry(tenantId: string, userId: string, sourceId: string, name: string, lines: PostLineInput[], entryDate?: string) {
  await reverseLatestEntryForSource(tenantId, "opening_balance", sourceId, userId, `Opening balance update - ${name}`);
  if (lines.length === 0) return;
  await postJournalEntry({
    tenantId,
    entryDate: entryDate ?? (await openingBalanceEntryDate(tenantId)),
    sourceType: "opening_balance",
    sourceId,
    referenceNumber: name,
    memo: `Opening balance - ${name}`,
    createdBy: userId,
    lines,
  });
}

// One account against "Brought forward": a positive net debit debits the account, a negative one credits it.
async function recordOpeningLines(tenantId: string, accountId: string, name: string, netDebit: number): Promise<PostLineInput[]> {
  if (netDebit === 0) return [];
  const broughtForward = await getOrCreateBroughtForwardAccount(tenantId);
  const amount = Math.abs(netDebit);
  const description = `Opening balance - ${name}`;
  return netDebit > 0
    ? [
        { accountId, debitAmount: amount, description },
        { accountId: broughtForward.id, creditAmount: amount, description },
      ]
    : [
        { accountId: broughtForward.id, debitAmount: amount, description },
        { accountId, creditAmount: amount, description },
      ];
}

// A customer's opening balance, routed through the customer's own receivable sub-account rather than the shared AR
// control account. Positive = they owe us.
export async function syncCustomerOpeningBalanceEntry(tenantId: string, customerId: string, customerName: string, openingBalance: number, userId: string) {
  const arId = openingBalance === 0 ? "" : await getOrCreateCustomerReceivableAccountId(tenantId, customerId);
  await replaceOpeningEntry(tenantId, userId, customerId, customerName, await recordOpeningLines(tenantId, arId, customerName, openingBalance));
}

// The AP mirror, through the supplier's own payable sub-account. Positive = we owe the supplier (the normal AP credit
// balance); negative means we're prepaid.
export async function syncSupplierOpeningBalanceEntry(tenantId: string, supplierId: string, supplierName: string, openingBalance: number, userId: string) {
  const apId = openingBalance === 0 ? "" : await getOrCreateSupplierPayableAccountId(tenantId, supplierId);
  await replaceOpeningEntry(tenantId, userId, supplierId, supplierName, await recordOpeningLines(tenantId, apId, supplierName, -openingBalance));
}

// A bank/cash account's opening balance, so the ledger (and the trial balance) carry it the same way. A positive balance
// is money in the account; a negative one is an overdraft.
export async function syncBankOpeningBalanceEntry(tenantId: string, bankAccountId: string, bankName: string, ledgerAccountId: string, openingBalance: number, userId: string) {
  await replaceOpeningEntry(tenantId, userId, bankAccountId, bankName, await recordOpeningLines(tenantId, ledgerAccountId, bankName, openingBalance));
}
