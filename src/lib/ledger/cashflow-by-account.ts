import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, payments } from "@/db/schema";
import { addDays } from "@/lib/calendar";
import { cashAccountRows } from "@/lib/dashboard/cash-flow";
import { buildCashFlowByAccount, type CashFlowByAccount, type FlowAccount, type FlowEntry } from "./cashflow-by-account-rules";

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const CHUNK = 1500;

async function balancesAsOf(tenantId: string, accountIds: string[], dayIso: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (accountIds.length === 0) return out;
  const rows = await db
    .select({ id: journalLines.accountId, d: sql<string>`coalesce(sum(${journalLines.debitAmount}), 0)`, c: sql<string>`coalesce(sum(${journalLines.creditAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds), lte(journalEntries.entryDate, dayIso)))
    .groupBy(journalLines.accountId);
  for (const r of rows) out.set(r.id, Math.round((num(r.d) - num(r.c)) * 100) / 100);
  return out;
}

/**
 * Cash flow by account for a period: every entry that moved a cash, bank or wallet account, with all its lines, sorted into rows by the rules in
 * cashflow-by-account-rules.ts. A voided or edited entry and the entry that reversed it are both left out when both fall in the period (they cancel),
 * the same as the Cash flow on the dashboard, so opening + what moved = closing still holds.
 */
export async function cashFlowByAccount(tenantId: string, from: string, to: string, opts: { showEmptyAccounts?: boolean } = {}): Promise<CashFlowByAccount> {
  const chart = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, category: accounts.category, subCategory: accounts.subCategory, parentId: accounts.parentAccountId })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));
  const infos = new Map<string, FlowAccount>(chart.map((a) => [a.id, a]));

  // The columns: the cash, bank and wallet accounts that hold money themselves (a group whose sub-accounts hold it is not a column).
  const rows = await cashAccountRows(tenantId);
  const ids = new Set(rows.map((r) => r.id));
  const hasChild = new Set([...ids].map((id) => infos.get(id)?.parentId).filter((p): p is string => Boolean(p) && ids.has(p as string)));
  const accountsOnShow = rows.filter((r) => !hasChild.has(r.id)).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const cashIds = accountsOnShow.map((r) => r.id);
  if (cashIds.length === 0) return buildCashFlowByAccount([], [], infos, opts);

  const reversal = alias(journalEntries, "reversal");
  const original = alias(journalEntries, "original");
  const touched = sql`exists (select 1 from ${journalLines} jl where jl.journal_entry_id = ${journalEntries.id} and jl.account_id in (${sql.join(cashIds.map((id) => sql`${id}`), sql`, `)}))`;

  const [heads, opening, closing] = await Promise.all([
    db
      .select({ id: journalEntries.id, sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, paymentType: payments.paymentType, origin: payments.origin })
      .from(journalEntries)
      .leftJoin(reversal, eq(reversal.reversalOfId, journalEntries.id))
      .leftJoin(original, eq(original.id, journalEntries.reversalOfId))
      .leftJoin(payments, and(eq(payments.journalEntryId, journalEntries.id), eq(payments.tenantId, journalEntries.tenantId)))
      .where(
        and(
          eq(journalEntries.tenantId, tenantId),
          gte(journalEntries.entryDate, from),
          lte(journalEntries.entryDate, to),
          touched,
          sql`not (${journalEntries.isReversed} and ${reversal.entryDate} between ${from} and ${to})`,
          sql`not (${journalEntries.reversalOfId} is not null and ${original.entryDate} between ${from} and ${to})`
        )
      )
      .groupBy(journalEntries.id, payments.paymentType, payments.origin),
    balancesAsOf(tenantId, cashIds, addDays(from, -1)),
    balancesAsOf(tenantId, cashIds, to),
  ]);

  const entryIds = heads.map((h) => h.id);
  const linesOf = new Map<string, FlowEntry["lines"]>();
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const part = await db
      .select({ entryId: journalLines.journalEntryId, accountId: journalLines.accountId, debit: journalLines.debitAmount, credit: journalLines.creditAmount })
      .from(journalLines)
      .where(inArray(journalLines.journalEntryId, entryIds.slice(i, i + CHUNK)));
    for (const l of part) {
      const list = linesOf.get(l.entryId) ?? [];
      list.push({ accountId: l.accountId, debit: num(l.debit), credit: num(l.credit) });
      linesOf.set(l.entryId, list);
    }
  }

  // A sale paid on the spot books its payment against the customer; the sale itself (its entry, on the same invoice) says which revenue accounts it was.
  const embeddedInvoices = [...new Set(heads.filter((h) => h.origin === "embedded" && h.sourceType === "receipt" && h.sourceId).map((h) => h.sourceId!))];
  const revenueOf = new Map<string, { accountId: string; weight: number }[]>();
  for (let i = 0; i < embeddedInvoices.length; i += CHUNK) {
    const sales = await db
      .select({ sourceId: journalEntries.sourceId, accountId: journalLines.accountId, credit: journalLines.creditAmount, debit: journalLines.debitAmount })
      .from(journalEntries)
      .innerJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "sale"), eq(journalEntries.isReversed, false), inArray(journalEntries.sourceId, embeddedInvoices.slice(i, i + CHUNK))));
    for (const s of sales) {
      if (infos.get(s.accountId)?.category !== "income") continue;
      const weight = num(s.credit) - num(s.debit);
      if (weight <= 0 || !s.sourceId) continue;
      const list = revenueOf.get(s.sourceId) ?? [];
      list.push({ accountId: s.accountId, weight });
      revenueOf.set(s.sourceId, list);
    }
  }

  const entries: FlowEntry[] = heads.map((h) => ({
    id: h.id,
    sourceType: h.sourceType,
    paymentType: h.paymentType ?? null,
    origin: h.origin ?? null,
    revenue: h.sourceId ? (revenueOf.get(h.sourceId) ?? []) : [],
    lines: linesOf.get(h.id) ?? [],
  }));

  const cash = accountsOnShow.map((r) => ({ id: r.id, name: r.name, code: r.code, opening: opening.get(r.id) ?? 0, ledgerClosing: closing.get(r.id) ?? 0 }));
  return buildCashFlowByAccount(entries, cash, infos, opts);
}
