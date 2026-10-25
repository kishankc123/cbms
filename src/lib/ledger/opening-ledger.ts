import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, customers, journalEntries, journalLines, tenants, vendors } from "@/db/schema";
import { getOrCreateBroughtForwardAccount } from "./control-accounts";
import { replaceOpeningEntry, syncBankOpeningBalanceEntry, syncCustomerOpeningBalanceEntry, syncSupplierOpeningBalanceEntry } from "./opening-balance";
import { buildOpeningLines, otherScreenFor } from "./opening-ledger-rules";

// The opening balance of every balance sheet account, enterable here or on the account's own screen. A customer's, supplier's or
// bank account's row is written through to that record (its Opening balance field), exactly as its own screen does; every other
// account goes into ONE entry (sourceType opening_balance, sourceId = the tenant) against Brought forward, replaced on each save.

export type OpeningRow = { id: string; code: string; name: string; category: string; net: number; other: number; screen: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;
const RANK: Record<string, number> = { asset: 0, liability: 1, equity: 2 };
const liveOpenings = (tenantId: string) =>
  and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "opening_balance"), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId));

export async function loadOpeningSheet(tenantId: string) {
  const [[tenant], all, sums, bf] = await Promise.all([
    db.select({ opening: tenants.openingBalanceDate, fiscalYearStart: tenants.fiscalYearStartDate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.isActive, true))),
    // Net debit of every opening entry per account, split into this screen's own entry and everyone else's.
    db
      .select({
        id: journalLines.accountId,
        mine: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}) filter (where ${journalEntries.sourceId} = ${tenantId}), 0)`,
        other: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}) filter (where ${journalEntries.sourceId} <> ${tenantId}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(liveOpenings(tenantId))
      .groupBy(journalLines.accountId),
    getOrCreateBroughtForwardAccount(tenantId),
  ]);
  const net = new Map(sums.map((s) => [s.id, { mine: Number(s.mine), other: Number(s.other) }]));
  const parents = new Set(all.map((a) => a.parentAccountId));
  const rows: OpeningRow[] = all
    .filter((a) => RANK[a.category] !== undefined && !parents.has(a.id) && a.id !== bf.id)
    // Accounts entered on their own screens (stock, fixed assets) sit at the bottom.
    .sort((x, y) => Number(!!otherScreenFor(x.code)) - Number(!!otherScreenFor(y.code)) || RANK[x.category] - RANK[y.category] || x.code.localeCompare(y.code))
    .map((a) => {
      const n = net.get(a.id) ?? { mine: 0, other: 0 };
      return { id: a.id, code: a.code, name: a.name, category: a.subCategory || a.category, net: round2(n.mine + n.other), other: round2(n.other), screen: otherScreenFor(a.code) };
    });
  return { date: tenant?.opening || tenant?.fiscalYearStart || null, rows };
}

/** The records whose own Opening balance field an account's row writes to. */
async function recordOwners(tenantId: string) {
  const [cs, vs, bs] = await Promise.all([
    db.select({ id: customers.id, name: customers.name, account: customers.receivableAccountId }).from(customers).where(eq(customers.tenantId, tenantId)),
    db.select({ id: vendors.id, name: vendors.name, account: vendors.payableAccountId }).from(vendors).where(eq(vendors.tenantId, tenantId)),
    db.select({ id: bankAccounts.id, name: bankAccounts.accountName, account: bankAccounts.chartOfAccountsLink }).from(bankAccounts).where(eq(bankAccounts.tenantId, tenantId)),
  ]);
  return new Map<string, { kind: "customer" | "supplier" | "bank"; id: string; name: string }>([
    ...cs.flatMap((c) => (c.account ? [[c.account, { kind: "customer" as const, id: c.id, name: c.name }] as const] : [])),
    ...vs.flatMap((v) => (v.account ? [[v.account, { kind: "supplier" as const, id: v.id, name: v.name }] as const] : [])),
    ...bs.map((b) => [b.account, { kind: "bank" as const, id: b.id, name: b.name }] as const),
  ]);
}

/**
 * Saves what was changed on the sheet (`netDebits`: account -> the total opening balance now wanted, debit positive). The server
 * works out which accounts may be changed and how; the browser's list is never trusted.
 */
export async function saveOpeningSheet(tenantId: string, userId: string, input: { date: string; netDebits: Record<string, number> }) {
  const { date } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Choose the opening balance date");
  const sheet = await loadOpeningSheet(tenantId);
  const byId = new Map(sheet.rows.map((r) => [r.id, r]));
  for (const [id, amount] of Object.entries(input.netDebits)) {
    const row = byId.get(id);
    if (!row || row.screen) throw new Error("An account in this list can't be changed here. Reload the page and try again.");
    if (!Number.isFinite(amount)) throw new Error(`The opening balance of ${row.name} is not a number`);
  }

  if (date !== sheet.date) {
    const [elsewhere] = await db
      .select({ date: journalEntries.entryDate })
      .from(journalEntries)
      .where(and(liveOpenings(tenantId), ne(journalEntries.sourceId, tenantId), ne(journalEntries.entryDate, date)))
      .limit(1);
    if (elsewhere) throw new Error(`Customers, suppliers, banks or assets already have opening balances dated ${elsewhere.date}, so the date can't be changed here.`);
    await db.update(tenants).set({ openingBalanceDate: date }).where(eq(tenants.id, tenantId));
  }

  const owners = await recordOwners(tenantId);
  const generic: { accountId: string; name: string; netDebit: number }[] = [];
  for (const row of sheet.rows) {
    if (row.screen) continue;
    const total = round2(input.netDebits[row.id] ?? row.net);
    const owner = owners.get(row.id);
    if (!owner) {
      generic.push({ accountId: row.id, name: row.name, netDebit: round2(total - row.other) }); // what other screens posted stays
    } else if (total !== row.other) {
      // The record's own Opening balance field changes, and its own entry is replaced, as on its own screen.
      if (owner.kind === "customer") {
        await db.update(customers).set({ openingBalance: total.toFixed(2) }).where(eq(customers.id, owner.id));
        await syncCustomerOpeningBalanceEntry(tenantId, owner.id, owner.name, total, userId);
      } else if (owner.kind === "supplier") {
        await db.update(vendors).set({ openingBalance: (-total).toFixed(2) }).where(eq(vendors.id, owner.id));
        await syncSupplierOpeningBalanceEntry(tenantId, owner.id, owner.name, -total, userId);
      } else {
        await db.update(bankAccounts).set({ openingBalance: total.toFixed(2) }).where(eq(bankAccounts.id, owner.id));
        await syncBankOpeningBalanceEntry(tenantId, owner.id, owner.name, row.id, total, userId);
      }
    }
  }

  const lines = buildOpeningLines(generic, (await getOrCreateBroughtForwardAccount(tenantId)).id);
  await replaceOpeningEntry(tenantId, userId, tenantId, "ledger accounts", lines, date);
  return { accounts: Object.keys(input.netDebits).length, date };
}
