import { and, desc, eq, lt, lte, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, users } from "@/db/schema";
import { NORMAL_BALANCE } from "@/db/schema/accounts";

/**
 * All reports below read directly from journal_entries/journal_lines — there is
 * no separately cached balance table. This is deliberate (spec section 4.6 /
 * section 8): reports must always tie out because they have no other source of
 * truth to drift away from.
 */

// journal_entries.entry_date is a pure SQL date ("YYYY-MM-DD", no time/timezone),
// so callers pass JS Date objects for convenience but we compare as date strings —
// this is what avoids the UTC/local off-by-one-day bug.
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

type AccountBalance = {
  accountId: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory: string | null;
  debitTotal: number;
  creditTotal: number;
  /** Signed per the account's normal balance: positive means "normal" side. */
  balance: number;
};

async function accountBalancesAsOf(tenantId: string, asOf: Date): Promise<AccountBalance[]> {
  const tenantAccounts = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId));

  const lines = await db
    .select({
      accountId: journalLines.accountId,
      debitAmount: journalLines.debitAmount,
      creditAmount: journalLines.creditAmount,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.tenantId, tenantId), lte(journalEntries.entryDate, toDateStr(asOf))));

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const t = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
    t.debit += Number(line.debitAmount);
    t.credit += Number(line.creditAmount);
    totals.set(line.accountId, t);
  }

  return tenantAccounts.map((a) => {
    const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
    const normal = NORMAL_BALANCE[a.category];
    const balance = normal === "debit" ? t.debit - t.credit : t.credit - t.debit;
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      category: a.category,
      subCategory: a.subCategory,
      debitTotal: t.debit,
      creditTotal: t.credit,
      balance,
    };
  });
}

export async function trialBalance(tenantId: string, asOf: Date) {
  const balances = await accountBalancesAsOf(tenantId, asOf);
  const rows = balances
    .filter((b) => b.debitTotal !== 0 || b.creditTotal !== 0)
    .map((b) => ({
      accountId: b.accountId,
      code: b.code,
      name: b.name,
      debit: NORMAL_BALANCE[b.category] === "debit" ? Math.max(b.balance, 0) : Math.max(-b.balance, 0),
      credit: NORMAL_BALANCE[b.category] === "credit" ? Math.max(b.balance, 0) : Math.max(-b.balance, 0),
    }));

  const totalDebit = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
  const totalCredit = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;

  return { asOf, rows, totalDebit, totalCredit, isBalanced: totalDebit === totalCredit };
}

export async function profitAndLoss(tenantId: string, periodStart: Date, periodEnd: Date) {
  // P&L is a period report: it nets activity between two dates, not a running balance,
  // so we compute it directly from lines within the window rather than reusing
  // accountBalancesAsOf (which is a point-in-time balance sheet-style helper).
  const tenantAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.category, ["income", "expense"])));

  const lines = await db
    .select({
      accountId: journalLines.accountId,
      debitAmount: journalLines.debitAmount,
      creditAmount: journalLines.creditAmount,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        gte(journalEntries.entryDate, toDateStr(periodStart)),
        lte(journalEntries.entryDate, toDateStr(periodEnd))
      )
    );

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of lines) {
    const t = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
    t.debit += Number(line.debitAmount);
    t.credit += Number(line.creditAmount);
    totals.set(line.accountId, t);
  }

  const income = tenantAccounts
    .filter((a) => a.category === "income")
    .map((a) => {
      const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
      return { accountId: a.id, code: a.code, name: a.name, amount: t.credit - t.debit };
    })
    .filter((r) => r.amount !== 0);

  const expenses = tenantAccounts
    .filter((a) => a.category === "expense")
    .map((a) => {
      const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
      return { accountId: a.id, code: a.code, name: a.name, amount: t.debit - t.credit };
    })
    .filter((r) => r.amount !== 0);

  const totalIncome = Math.round(income.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const totalExpenses = Math.round(expenses.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100;

  return { periodStart, periodEnd, income, expenses, totalIncome, totalExpenses, netProfit };
}

export async function balanceSheet(tenantId: string, asOf: Date) {
  const balances = await accountBalancesAsOf(tenantId, asOf);

  const assets = balances.filter((b) => b.category === "asset" && b.balance !== 0);
  const liabilities = balances.filter((b) => b.category === "liability" && b.balance !== 0);
  const equityAccounts = balances.filter((b) => b.category === "equity" && b.balance !== 0);

  // Retained earnings = accumulated net profit not yet closed to an equity account.
  // Since we never run a period-close/closing-entry step, we fold current and prior
  // period net income straight into equity for display purposes.
  const pnl = await profitAndLoss(tenantId, new Date(0), asOf);

  const totalAssets = Math.round(assets.reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const totalLiabilities = Math.round(liabilities.reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const totalEquityAccounts = Math.round(equityAccounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const retainedEarnings = pnl.netProfit;
  const totalEquity = Math.round((totalEquityAccounts + retainedEarnings) * 100) / 100;

  return {
    asOf,
    assets: assets.map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, amount: a.balance })),
    liabilities: liabilities.map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, amount: a.balance })),
    equity: equityAccounts.map((a) => ({ accountId: a.accountId, code: a.code, name: a.name, amount: a.balance })),
    retainedEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    isBalanced: totalAssets === Math.round((totalLiabilities + totalEquity) * 100) / 100,
  };
}

// Same set cash-bank-accounts.ts uses for "where can a payment land" — the "1000 Cash" account plus
// everything under "1010 Bank" (individual bank accounts included via their dotted sub-codes).
const isCashOrBankCode = (code: string) => code === "1000" || code.startsWith("1010");

export type CashFlowLine = { accountId: string; code: string; name: string; amount: number };

/**
 * Indirect method: start from net profit, then walk every non-cash balance-sheet account's movement
 * over the period and classify it — asset movement under "Fixed assets" is investing, everything else
 * asset/current-liability is a working-capital operating adjustment, non-current liabilities and equity
 * are financing. Because that classification covers every balance-sheet account with no gaps, the three
 * activities always sum to the period's actual cash movement (checked below as `isBalanced`, the same
 * self-verifying pattern Trial Balance and the Balance Sheet use) rather than needing a separate ledger.
 */
export async function cashFlowStatement(tenantId: string, periodStart: Date, periodEnd: Date) {
  const periodStartExclusive = new Date(periodStart.getTime() - 24 * 60 * 60 * 1000);
  const [opening, closing, pnl] = await Promise.all([
    accountBalancesAsOf(tenantId, periodStartExclusive),
    accountBalancesAsOf(tenantId, periodEnd),
    profitAndLoss(tenantId, periodStart, periodEnd),
  ]);

  const openingByAccount = new Map(opening.map((b) => [b.accountId, b.balance]));

  const operating: CashFlowLine[] = [];
  const investing: CashFlowLine[] = [];
  const financing: CashFlowLine[] = [];
  let cashDelta = 0;

  for (const c of closing) {
    if (c.category === "income" || c.category === "expense") continue; // already captured in netProfit
    const delta = Math.round((c.balance - (openingByAccount.get(c.accountId) ?? 0)) * 100) / 100;
    if (delta === 0) continue;

    if (isCashOrBankCode(c.code)) {
      cashDelta += delta;
      continue;
    }

    const line: CashFlowLine = { accountId: c.accountId, code: c.code, name: c.name, amount: c.category === "asset" ? -delta : delta };
    if (c.category === "asset") (c.subCategory === "Fixed assets" ? investing : operating).push(line);
    else if (c.category === "liability") (c.subCategory === "Non current liabilities" ? financing : operating).push(line);
    else financing.push(line); // equity
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const netCashFromOperating = round2(pnl.netProfit + operating.reduce((s, r) => s + r.amount, 0));
  const netCashFromInvesting = round2(investing.reduce((s, r) => s + r.amount, 0));
  const netCashFromFinancing = round2(financing.reduce((s, r) => s + r.amount, 0));
  const netChangeInCash = round2(netCashFromOperating + netCashFromInvesting + netCashFromFinancing);
  const actualCashMovement = round2(cashDelta);

  return {
    periodStart,
    periodEnd,
    netProfit: pnl.netProfit,
    operating,
    investing,
    financing,
    netCashFromOperating,
    netCashFromInvesting,
    netCashFromFinancing,
    netChangeInCash,
    actualCashMovement,
    isBalanced: netChangeInCash === actualCashMovement,
  };
}

export async function generalLedger(tenantId: string, accountId: string, periodStart: Date, periodEnd: Date) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.tenantId, tenantId)))
    .limit(1);
  if (!account) throw new Error("Account not found");

  const rows = await db
    .select({
      entryDate: journalEntries.entryDate,
      referenceNumber: journalEntries.referenceNumber,
      memo: journalEntries.memo,
      description: journalLines.description,
      debitAmount: journalLines.debitAmount,
      creditAmount: journalLines.creditAmount,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalLines.accountId, accountId),
        gte(journalEntries.entryDate, toDateStr(periodStart)),
        lte(journalEntries.entryDate, toDateStr(periodEnd))
      )
    )
    .orderBy(journalEntries.entryDate);

  const normal = NORMAL_BALANCE[account.category];

  // Balance carried in from before the period, so the running balance is real.
  const priorLines = await db
    .select({ debitAmount: journalLines.debitAmount, creditAmount: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, accountId), lt(journalEntries.entryDate, toDateStr(periodStart))));
  let openingBalance = 0;
  for (const l of priorLines) {
    const d = Number(l.debitAmount) - Number(l.creditAmount);
    openingBalance += normal === "debit" ? d : -d;
  }

  let running = openingBalance;
  const withRunningBalance = rows.map((r) => {
    const debit = Number(r.debitAmount);
    const credit = Number(r.creditAmount);
    running += normal === "debit" ? debit - credit : credit - debit;
    return { ...r, debit, credit, runningBalance: running };
  });

  return { account, openingBalance, lines: withRunningBalance };
}

export type JournalReportLine = {
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  description: string | null;
};

export type JournalReportEntry = {
  id: string;
  entryDate: string;
  referenceNumber: string | null;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  createdBy: string;
  isReversed: boolean;
  reversalOfId: string | null;
  lines: JournalReportLine[];
};

const MAX_JOURNAL_ENTRIES = 500;

/**
 * Every posted journal entry in the period, each with its own lines (one row per account, matching how a
 * voucher actually reads: "Dr Customer Receivable 100,000 / Cr Sales Revenue 88,495 / Cr VAT Payable
 * 11,505"). Capped so a very wide date range can't turn this into an unbounded scan — narrow the filter
 * instead of raising the cap.
 */
export async function journalReport(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  opts: { sourceType?: string; search?: string } = {}
) {
  const entryRows = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        gte(journalEntries.entryDate, toDateStr(periodStart)),
        lte(journalEntries.entryDate, toDateStr(periodEnd)),
        ...(opts.sourceType ? [eq(journalEntries.sourceType, opts.sourceType as (typeof journalEntries.sourceType.enumValues)[number])] : [])
      )
    )
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(MAX_JOURNAL_ENTRIES);

  const q = opts.search?.trim().toLowerCase();
  const filtered = q
    ? entryRows.filter((e) => (e.referenceNumber ?? "").toLowerCase().includes(q) || (e.memo ?? "").toLowerCase().includes(q))
    : entryRows;
  if (filtered.length === 0) return { entries: [], truncated: entryRows.length >= MAX_JOURNAL_ENTRIES };

  const ids = filtered.map((e) => e.id);
  const [lineRows, accountRows, userRows] = await Promise.all([
    db.select().from(journalLines).where(inArray(journalLines.journalEntryId, ids)),
    db.select().from(accounts).where(eq(accounts.tenantId, tenantId)),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const userNameById = new Map(userRows.map((u) => [u.id, u.name]));
  const linesByEntry = new Map<string, JournalReportLine[]>();
  for (const l of lineRows) {
    const acc = accountById.get(l.accountId);
    const line: JournalReportLine = {
      accountId: l.accountId,
      code: acc?.code ?? "",
      name: acc?.name ?? "Unknown account",
      debit: Number(l.debitAmount),
      credit: Number(l.creditAmount),
      description: l.description,
    };
    linesByEntry.set(l.journalEntryId, [...(linesByEntry.get(l.journalEntryId) ?? []), line]);
  }

  const entries: JournalReportEntry[] = filtered.map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    referenceNumber: e.referenceNumber,
    memo: e.memo,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    createdBy: userNameById.get(e.createdBy) ?? "—",
    isReversed: e.isReversed,
    reversalOfId: e.reversalOfId,
    lines: linesByEntry.get(e.id) ?? [],
  }));

  return { entries, truncated: entryRows.length >= MAX_JOURNAL_ENTRIES };
}

export type TransactionRegisterEntry = {
  id: string;
  entryDate: string;
  referenceNumber: string | null;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  createdBy: string;
  isReversed: boolean;
  reversalOfId: string | null;
  amount: number;
};

const MAX_REGISTER_ENTRIES = 1000;

/**
 * One row per transaction (not per debit/credit line) — the flat chronological view Journal Report's
 * per-line detail complements. Amount is the entry's total debit (== total credit, since every posted
 * entry balances), so it reads as "how much did this transaction move," not an account-specific figure.
 */
export async function transactionRegister(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  opts: { sourceType?: string; search?: string } = {}
) {
  const entryRows = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        gte(journalEntries.entryDate, toDateStr(periodStart)),
        lte(journalEntries.entryDate, toDateStr(periodEnd)),
        ...(opts.sourceType ? [eq(journalEntries.sourceType, opts.sourceType as (typeof journalEntries.sourceType.enumValues)[number])] : [])
      )
    )
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(MAX_REGISTER_ENTRIES);

  const q = opts.search?.trim().toLowerCase();
  const filtered = q
    ? entryRows.filter((e) => (e.referenceNumber ?? "").toLowerCase().includes(q) || (e.memo ?? "").toLowerCase().includes(q))
    : entryRows;
  if (filtered.length === 0) return { entries: [], truncated: entryRows.length >= MAX_REGISTER_ENTRIES };

  const ids = filtered.map((e) => e.id);
  const [lineRows, userRows] = await Promise.all([
    db.select({ journalEntryId: journalLines.journalEntryId, debitAmount: journalLines.debitAmount }).from(journalLines).where(inArray(journalLines.journalEntryId, ids)),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const userNameById = new Map(userRows.map((u) => [u.id, u.name]));
  const debitTotalByEntry = new Map<string, number>();
  for (const l of lineRows) {
    debitTotalByEntry.set(l.journalEntryId, (debitTotalByEntry.get(l.journalEntryId) ?? 0) + Number(l.debitAmount));
  }

  const entries: TransactionRegisterEntry[] = filtered.map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    referenceNumber: e.referenceNumber,
    memo: e.memo,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    createdBy: userNameById.get(e.createdBy) ?? "—",
    isReversed: e.isReversed,
    reversalOfId: e.reversalOfId,
    amount: Math.round((debitTotalByEntry.get(e.id) ?? 0) * 100) / 100,
  }));

  return { entries, truncated: entryRows.length >= MAX_REGISTER_ENTRIES };
}
