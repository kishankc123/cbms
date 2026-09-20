import { and, eq, lt, lte, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "@/db/schema";
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
      return { code: a.code, name: a.name, amount: t.credit - t.debit };
    })
    .filter((r) => r.amount !== 0);

  const expenses = tenantAccounts
    .filter((a) => a.category === "expense")
    .map((a) => {
      const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
      return { code: a.code, name: a.name, amount: t.debit - t.credit };
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
    assets: assets.map((a) => ({ code: a.code, name: a.name, amount: a.balance })),
    liabilities: liabilities.map((a) => ({ code: a.code, name: a.name, amount: a.balance })),
    equity: equityAccounts.map((a) => ({ code: a.code, name: a.name, amount: a.balance })),
    retainedEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    isBalanced: totalAssets === Math.round((totalLiabilities + totalEquity) * 100) / 100,
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
