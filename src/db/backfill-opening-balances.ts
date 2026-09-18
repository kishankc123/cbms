// One-off backfill: posts a "Brought forward" journal entry for every
// existing customer/vendor whose openingBalance predates the opening-balance
// ledger linkage, so their balances participate in the trial balance too.
// Safe to re-run — reverseLatestEntryForSource is a no-op when nothing is
// posted yet, and posting is skipped if an active entry already exists.
import { eq, and, ne, isNull } from "drizzle-orm";
import { db } from "./index";
import { customers, vendors, employees, journalEntries, users } from "./schema";
import { postJournalEntry, type PostLineInput } from "../lib/ledger/post";
import { findControlAccount, getOrCreateBroughtForwardAccount } from "../lib/ledger/control-accounts";
import { createEmployeePayableAccount } from "../lib/ledger/payroll-accounts";

async function hasActiveOpeningBalanceEntry(tenantId: string, sourceId: string) {
  const [entry] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, "opening_balance"),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.isReversed, false)
      )
    )
    .limit(1);
  return Boolean(entry);
}

async function main() {
  let posted = 0;
  let skipped = 0;

  const allCustomers = await db.select().from(customers).where(ne(customers.openingBalance, "0"));
  for (const customer of allCustomers) {
    if (await hasActiveOpeningBalanceEntry(customer.tenantId, customer.id)) {
      skipped++;
      continue;
    }
    const [systemUser] = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, customer.tenantId)).limit(1);
    if (!systemUser) continue;

    const ar = await findControlAccount(customer.tenantId, ["1100"], "Accounts Receivable");
    if (!ar) {
      console.warn(`Skipping customer ${customer.name} (${customer.tenantId}) — no Accounts Receivable account`);
      continue;
    }
    const broughtForward = await getOrCreateBroughtForwardAccount(customer.tenantId);

    const openingBalance = Number(customer.openingBalance);
    const amount = Math.abs(openingBalance);
    const lines: PostLineInput[] =
      openingBalance > 0
        ? [
            { accountId: ar.id, debitAmount: amount, description: `Opening balance - ${customer.name}` },
            { accountId: broughtForward.id, creditAmount: amount, description: `Opening balance - ${customer.name}` },
          ]
        : [
            { accountId: broughtForward.id, debitAmount: amount, description: `Opening balance - ${customer.name}` },
            { accountId: ar.id, creditAmount: amount, description: `Opening balance - ${customer.name}` },
          ];

    await postJournalEntry({
      tenantId: customer.tenantId,
      entryDate: new Date().toISOString().slice(0, 10),
      sourceType: "opening_balance",
      sourceId: customer.id,
      referenceNumber: customer.name,
      memo: `Opening balance - ${customer.name} (backfilled)`,
      createdBy: systemUser.id,
      lines,
    });
    posted++;
    console.log(`Posted opening balance for customer ${customer.name}: ${openingBalance}`);
  }

  const allVendors = await db.select().from(vendors).where(ne(vendors.openingBalance, "0"));
  for (const vendor of allVendors) {
    if (await hasActiveOpeningBalanceEntry(vendor.tenantId, vendor.id)) {
      skipped++;
      continue;
    }
    const [systemUser] = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, vendor.tenantId)).limit(1);
    if (!systemUser) continue;

    const ap = await findControlAccount(vendor.tenantId, ["2000"], "Accounts Payable");
    if (!ap) {
      console.warn(`Skipping supplier ${vendor.name} (${vendor.tenantId}) — no Accounts Payable account`);
      continue;
    }
    const broughtForward = await getOrCreateBroughtForwardAccount(vendor.tenantId);

    const openingBalance = Number(vendor.openingBalance);
    const amount = Math.abs(openingBalance);
    const lines: PostLineInput[] =
      openingBalance > 0
        ? [
            { accountId: broughtForward.id, debitAmount: amount, description: `Opening balance - ${vendor.name}` },
            { accountId: ap.id, creditAmount: amount, description: `Opening balance - ${vendor.name}` },
          ]
        : [
            { accountId: ap.id, debitAmount: amount, description: `Opening balance - ${vendor.name}` },
            { accountId: broughtForward.id, creditAmount: amount, description: `Opening balance - ${vendor.name}` },
          ];

    await postJournalEntry({
      tenantId: vendor.tenantId,
      entryDate: new Date().toISOString().slice(0, 10),
      sourceType: "opening_balance",
      sourceId: vendor.id,
      referenceNumber: vendor.name,
      memo: `Opening balance - ${vendor.name} (backfilled)`,
      createdBy: systemUser.id,
      lines,
    });
    posted++;
    console.log(`Posted opening balance for supplier ${vendor.name}: ${openingBalance}`);
  }

  let employeesLinked = 0;
  const unlinkedEmployees = await db.select().from(employees).where(isNull(employees.payableAccountId));
  for (const employee of unlinkedEmployees) {
    const account = await createEmployeePayableAccount(employee.tenantId, employee.fullName);
    await db.update(employees).set({ payableAccountId: account.id }).where(eq(employees.id, employee.id));
    employeesLinked++;
    console.log(`Linked Salary Payable sub-account for employee ${employee.fullName}`);
  }

  console.log(
    `Done. Posted ${posted} opening balance entries, skipped ${skipped} already-linked, linked ${employeesLinked} employee payable accounts.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
