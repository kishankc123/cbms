import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { postJournalEntry, reverseLatestEntryForSource, type PostLineInput } from "./post";
import { getOrCreateBroughtForwardAccount } from "./control-accounts";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";

import { todayIso } from "@/lib/calendar";
async function openingBalanceEntryDate(tenantId: string) {
  const [tenant] = await db
    .select({ fiscalYearStartDate: tenants.fiscalYearStartDate })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.fiscalYearStartDate || todayIso();
}

// Posts (or, if the balance is now zero, simply leaves reversed) a customer's
// opening balance against the "Brought forward" equity account, routed
// through the customer's own receivable sub-account rather than the shared
// AR control account. Always reverses whatever was posted before first —
// safe to call on every create/update since reversing a non-existent entry
// is a no-op.
export async function syncCustomerOpeningBalanceEntry(
  tenantId: string,
  customerId: string,
  customerName: string,
  openingBalance: number,
  userId: string
) {
  await reverseLatestEntryForSource(tenantId, "opening_balance", customerId, userId, `Opening balance update - ${customerName}`);
  if (openingBalance === 0) return;

  const arId = await getOrCreateCustomerReceivableAccountId(tenantId, customerId);
  const broughtForward = await getOrCreateBroughtForwardAccount(tenantId);

  const amount = Math.abs(openingBalance);
  const lines: PostLineInput[] =
    openingBalance > 0
      ? [
          { accountId: arId, debitAmount: amount, description: `Opening balance - ${customerName}` },
          { accountId: broughtForward.id, creditAmount: amount, description: `Opening balance - ${customerName}` },
        ]
      : [
          { accountId: broughtForward.id, debitAmount: amount, description: `Opening balance - ${customerName}` },
          { accountId: arId, creditAmount: amount, description: `Opening balance - ${customerName}` },
        ];

  await postJournalEntry({
    tenantId,
    entryDate: await openingBalanceEntryDate(tenantId),
    sourceType: "opening_balance",
    sourceId: customerId,
    referenceNumber: customerName,
    memo: `Opening balance - ${customerName}`,
    createdBy: userId,
    lines,
  });
}

// Posts a supplier's opening balance against "Brought forward" — the AP
// mirror of the customer version, routed through the supplier's own payable
// sub-account. A positive balance means we owe the supplier (the normal AP
// credit balance); negative means we're prepaid.
export async function syncSupplierOpeningBalanceEntry(
  tenantId: string,
  supplierId: string,
  supplierName: string,
  openingBalance: number,
  userId: string
) {
  await reverseLatestEntryForSource(tenantId, "opening_balance", supplierId, userId, `Opening balance update - ${supplierName}`);
  if (openingBalance === 0) return;

  const apId = await getOrCreateSupplierPayableAccountId(tenantId, supplierId);
  const broughtForward = await getOrCreateBroughtForwardAccount(tenantId);

  const amount = Math.abs(openingBalance);
  const lines: PostLineInput[] =
    openingBalance > 0
      ? [
          { accountId: broughtForward.id, debitAmount: amount, description: `Opening balance - ${supplierName}` },
          { accountId: apId, creditAmount: amount, description: `Opening balance - ${supplierName}` },
        ]
      : [
          { accountId: apId, debitAmount: amount, description: `Opening balance - ${supplierName}` },
          { accountId: broughtForward.id, creditAmount: amount, description: `Opening balance - ${supplierName}` },
        ];

  await postJournalEntry({
    tenantId,
    entryDate: await openingBalanceEntryDate(tenantId),
    sourceType: "opening_balance",
    sourceId: supplierId,
    referenceNumber: supplierName,
    memo: `Opening balance - ${supplierName}`,
    createdBy: userId,
    lines,
  });
}

// Posts a bank/cash account's opening balance against "Brought forward", so the ledger (and the trial balance) carry
// it — the same way customer and supplier opening balances are carried. A positive balance is money in the account;
// a negative one is an overdraft. Reverses whatever was posted before first, so it is safe on every create/update.
export async function syncBankOpeningBalanceEntry(
  tenantId: string,
  bankAccountId: string,
  bankName: string,
  ledgerAccountId: string,
  openingBalance: number,
  userId: string
) {
  await reverseLatestEntryForSource(tenantId, "opening_balance", bankAccountId, userId, `Opening balance update - ${bankName}`);
  if (openingBalance === 0) return;

  const broughtForward = await getOrCreateBroughtForwardAccount(tenantId);
  const amount = Math.abs(openingBalance);
  const lines: PostLineInput[] =
    openingBalance > 0
      ? [
          { accountId: ledgerAccountId, debitAmount: amount, description: `Opening balance - ${bankName}` },
          { accountId: broughtForward.id, creditAmount: amount, description: `Opening balance - ${bankName}` },
        ]
      : [
          { accountId: broughtForward.id, debitAmount: amount, description: `Opening balance - ${bankName}` },
          { accountId: ledgerAccountId, creditAmount: amount, description: `Opening balance - ${bankName}` },
        ];

  await postJournalEntry({
    tenantId,
    entryDate: await openingBalanceEntryDate(tenantId),
    sourceType: "opening_balance",
    sourceId: bankAccountId,
    referenceNumber: bankName,
    memo: `Opening balance - ${bankName}`,
    createdBy: userId,
    lines,
  });
}
