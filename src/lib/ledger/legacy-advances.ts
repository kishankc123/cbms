import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, journalEntries, journalLines, vendors } from "@/db/schema";
import { postJournalEntry } from "./post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import { previewSettlement, resettleParty, type SettlementChange } from "./party-settlement";
import { todayIso } from "@/lib/calendar";

// Money a customer or supplier paid ahead used to sit on a separate Advance account of theirs until it was applied by hand.
// It now goes on their own ledger account like every other receipt or payment. This moves what is still on the old Advance
// accounts onto the party's own account (a customer's advance Dr Advance / Cr Receivable; a supplier's the other way round), so
// nobody's net balance changes, then settles every customer's invoices and every supplier's bills from the ledger once.

const round2 = (n: number) => Math.round(n * 100) / 100;

// Moves one party's old Advance balance onto their own account, and returns the amount (without posting anything when `post` is off).
async function moveOne(tenantId: string, userId: string, name: string, advanceId: string, ledgerId: string, post: boolean) {
  const [row] = await db
    .select({ net: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, advanceId)));
  const net = round2(Number(row?.net ?? 0));
  if (net === 0) return 0;
  const amount = Math.abs(net);
  if (!post) return amount;
  const description = "Advance moved to the party's own account";
  await postJournalEntry({
    tenantId,
    entryDate: todayIso(),
    sourceType: "manual",
    memo: `Advance moved to ${name}'s own account`,
    createdBy: userId,
    lines: net > 0 ? [{ accountId: advanceId, creditAmount: amount, description }, { accountId: ledgerId, debitAmount: amount, description }] : [{ accountId: advanceId, debitAmount: amount, description }, { accountId: ledgerId, creditAmount: amount, description }],
  });
  return amount;
}

/**
 * Moves the old Advance balances and settles every customer's invoices and supplier's bills from the ledger. With `userId` null it
 * only reports: the advance amounts that would move and the documents whose paid figure would change (before the advances move).
 */
export async function settleAllFromLedger(tenantId: string, userId: string | null) {
  const post = userId !== null;
  const [cs, vs] = await Promise.all([
    db.select({ id: customers.id, name: customers.name, advance: customers.advanceAccountId }).from(customers).where(and(eq(customers.tenantId, tenantId), or(isNotNull(customers.receivableAccountId), isNotNull(customers.advanceAccountId)))),
    db.select({ id: vendors.id, name: vendors.name, advance: vendors.advanceAccountId }).from(vendors).where(and(eq(vendors.tenantId, tenantId), or(isNotNull(vendors.payableAccountId), isNotNull(vendors.advanceAccountId)))),
  ]);
  let moved = 0;
  const changes: (SettlementChange & { party: string })[] = [];
  const parties = [...cs.map((c) => ({ ...c, side: "customer" as const })), ...vs.map((v) => ({ ...v, side: "supplier" as const }))];
  for (const p of parties) {
    if (p.advance) {
      const ledgerId = post ? await (p.side === "customer" ? getOrCreateCustomerReceivableAccountId : getOrCreateSupplierPayableAccountId)(tenantId, p.id) : "";
      moved += await moveOne(tenantId, userId ?? "", p.name, p.advance, ledgerId, post);
    }
    if (post) await resettleParty(tenantId, p.side, p.id);
    else changes.push(...(await previewSettlement(tenantId, p.side, p.id)).map((c) => ({ ...c, party: p.name })));
  }
  return { customers: cs.length, suppliers: vs.length, moved, changes };
}
