// One-time repair: early sales invoices, receipts and purchase bills were posted to the shared
// Accounts Receivable / Accounts Payable CONTROL accounts instead of the customer's / supplier's own
// sub-account (sub-accounts came later). The control account's total is right, but the party's own
// ledger misses those amounts. This moves each party's share across with one reclassification entry.
//
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/reclass-party-balances.ts          (dry run)
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/reclass-party-balances.ts --apply
//
// Idempotent: once a party has nothing left on the control account, it does nothing for them. Totals
// (trial balance, control-group balances) do not change.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { accounts, customers, journalEntries, journalLines, memberships, purchaseBills, salesInvoices, tenants, vendors } from "./schema";
import { postJournalEntry } from "../lib/ledger/post";
import { todayIso } from "../lib/calendar";

const apply = process.argv.includes("--apply");
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const all = await db.select().from(tenants);
  for (const tenant of all) {
    const [owner] = await db.select().from(memberships).where(eq(memberships.tenantId, tenant.id)).limit(1);
    if (!owner) continue;

    for (const side of ["customer", "supplier"] as const) {
      const controlCode = side === "customer" ? "1100" : "2000";
      const [control] = await db.select().from(accounts).where(and(eq(accounts.tenantId, tenant.id), eq(accounts.code, controlCode), isNull(accounts.parentAccountId))).limit(1);
      if (!control) continue;

      const lines = await db
        .select({ debit: journalLines.debitAmount, credit: journalLines.creditAmount, sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, memo: journalEntries.memo })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
        .where(and(eq(journalEntries.tenantId, tenant.id), eq(journalLines.accountId, control.id)));
      if (lines.length === 0) continue;

      // Which party does each line belong to?
      const parties = side === "customer"
        ? await db.select({ id: customers.id, name: customers.name, accountId: customers.receivableAccountId }).from(customers).where(eq(customers.tenantId, tenant.id))
        : await db.select({ id: vendors.id, name: vendors.name, accountId: vendors.payableAccountId }).from(vendors).where(eq(vendors.tenantId, tenant.id));
      const partyIds = new Set(parties.map((p) => p.id));
      const docs = side === "customer"
        ? await db.select({ id: salesInvoices.id, party: salesInvoices.customerId, number: salesInvoices.invoiceNumber }).from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id))
        : await db.select({ id: purchaseBills.id, party: purchaseBills.vendorId, number: purchaseBills.billNumber }).from(purchaseBills).where(eq(purchaseBills.tenantId, tenant.id));
      const docParty = new Map(docs.map((d) => [d.id, d.party as string | null]));
      const byNumber = new Map<string, Set<string>>();
      for (const d of docs) if (d.party) byNumber.set(d.number, new Set([...(byNumber.get(d.number) ?? []), d.party]));

      const net = new Map<string, number>();
      const unattributed: { sourceType: string; memo: string | null; amount: number }[] = [];
      for (const l of lines) {
        // debit-normal for customers, credit-normal for suppliers
        const amount = side === "customer" ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
        let party: string | null = null;
        if (l.sourceId && docParty.has(l.sourceId)) party = docParty.get(l.sourceId) ?? null;
        else if (l.sourceId && partyIds.has(l.sourceId)) party = l.sourceId; // opening balance entries point at the party
        else {
          const m = /^Payment (?:received for|made for) (.+?)(?: \(edited\))?$/.exec(l.memo ?? "");
          const candidates = m ? byNumber.get(m[1]) : undefined;
          if (candidates && candidates.size === 1) party = [...candidates][0];
        }
        if (!party) unattributed.push({ sourceType: l.sourceType, memo: l.memo, amount });
        else net.set(party, round2((net.get(party) ?? 0) + amount));
      }

      console.log(`\n${tenant.companyName} — ${side}s on control ${controlCode}:`);
      if (unattributed.length) console.log(`  ! ${unattributed.length} line(s) could not be attributed (left where they are):`, unattributed.slice(0, 5));
      for (const [partyId, amount] of net) {
        if (Math.abs(amount) < 0.005) continue;
        const party = parties.find((p) => p.id === partyId);
        if (!party?.accountId) {
          console.log(`  ! ${party?.name ?? partyId}: ${amount} has no sub-account`);
          continue;
        }
        console.log(`  ${party.name}: move ${amount.toFixed(2)} to its own account${apply ? "" : "  (dry run)"}`);
        if (!apply) continue;
        // amount is the party's share of the control balance on its normal side. Move it to their own account:
        //  customer (debit-normal):  Dr party / Cr control          supplier (credit-normal): Dr control / Cr party
        const abs = Math.abs(amount);
        const partyIsDebited = side === "customer" ? amount > 0 : amount < 0;
        const fixed = partyIsDebited
          ? [{ accountId: party.accountId, debitAmount: abs, description: "Reclassified from control account" }, { accountId: control.id, creditAmount: abs, description: "Reclassified to party account" }]
          : [{ accountId: control.id, debitAmount: abs, description: "Reclassified to party account" }, { accountId: party.accountId, creditAmount: abs, description: "Reclassified from control account" }];
        await postJournalEntry({
          tenantId: tenant.id,
          entryDate: todayIso(),
          sourceType: "manual",
          referenceNumber: "RECLASS",
          memo: `Reclassify ${party.name}'s balance from ${controlCode} to their own account`,
          createdBy: owner.userId,
          lines: fixed,
        });
      }
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
