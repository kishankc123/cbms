import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, journalEntries, journalLines, supplierReconciliations, vendors } from "@/db/schema";
import { isCashSaleCustomer } from "@/lib/sales/cash-sale";
import { getCustomerLines } from "./customer-balances";
import { getSupplierLines } from "./supplier-balances";
import { buildPartyRow, controlCheck, totalsOf, type ControlCheck, type PartyRow, type PartyTotals } from "./party-balances-rules";

export * from "./party-balances-rules";

export type ReconState = { state: "reconciled" | "in_progress" | "unreconciled"; /** The end of the reconciliation that counts, or (unreconciled) the last one signed off. */ through: string | null };

export type TradeReport = {
  rows: PartyRow[];
  totals: PartyTotals;
  check: ControlCheck;
  /** Parties not in the table (the Cash Sale stand-in customer), so the check above still counts them. */
  leftOut: { label: string; closing: number } | null;
  /** Payables only: how each supplier stands in the supplier reconciliation. */
  recon: Record<string, ReconState> | null;
};

/** What the control account (Accounts Payable / Accounts Receivable) and every account under it hold at the end of a day, signed to its normal side. */
async function controlBalance(tenantId: string, code: string, normal: "debit" | "credit", asOf: string): Promise<number> {
  const chart = await db.select({ id: accounts.id, code: accounts.code, parentId: accounts.parentAccountId }).from(accounts).where(eq(accounts.tenantId, tenantId));
  const root = chart.find((a) => a.code === code);
  if (!root) return 0;
  const ids = new Set([root.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of chart) {
      if (a.parentId && ids.has(a.parentId) && !ids.has(a.id)) {
        ids.add(a.id);
        grew = true;
      }
    }
  }
  const [row] = await db
    .select({ d: sql<string>`coalesce(sum(${journalLines.debitAmount}), 0)`, c: sql<string>`coalesce(sum(${journalLines.creditAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, [...ids]), lte(journalEntries.entryDate, asOf)));
  const d = Number(row?.d ?? 0);
  const c = Number(row?.c ?? 0);
  return Math.round((normal === "credit" ? c - d : d - c) * 100) / 100;
}

/**
 * Where each supplier stands in the supplier reconciliation for a period: reconciled when a signed-off reconciliation ends inside the period (or covers its
 * last day), in progress when a draft does, otherwise unreconciled (with the last day they were reconciled up to, if ever).
 */
async function reconStates(tenantId: string, vendorIds: string[], from: string, to: string): Promise<Record<string, ReconState>> {
  const recs = await db
    .select({ vendorId: supplierReconciliations.vendorId, from: supplierReconciliations.fromDate, to: supplierReconciliations.toDate, status: supplierReconciliations.status })
    .from(supplierReconciliations)
    .where(eq(supplierReconciliations.tenantId, tenantId));
  const out: Record<string, ReconState> = {};
  for (const id of vendorIds) {
    const mine = recs.filter((r) => r.vendorId === id);
    const counts = (r: { from: string; to: string }) => (r.to >= from && r.to <= to) || (r.from <= to && r.to >= to);
    const signed = mine.filter((r) => r.status === "reconciled");
    const hit = signed.filter(counts).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    if (hit) {
      out[id] = { state: "reconciled", through: hit.to };
      continue;
    }
    const draft = mine.filter((r) => r.status === "draft" && counts(r)).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    if (draft) {
      out[id] = { state: "in_progress", through: draft.to };
      continue;
    }
    const last = signed.map((r) => r.to).sort().at(-1) ?? null;
    out[id] = { state: "unreconciled", through: last };
  }
  return out;
}

export async function tradePayables(tenantId: string, from: string, to: string): Promise<TradeReport> {
  const [list, lines, ledger] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)),
    getSupplierLines(tenantId),
    controlBalance(tenantId, "2000", "credit", to),
  ]);
  const all = list.map((v) => buildPartyRow({ id: v.id, name: v.name, lines: lines.get(v.id) ?? [] }, "credit", { from, to }));
  const rows = all.filter((r) => r.active);
  const recon = await reconStates(tenantId, rows.map((r) => r.id), from, to);
  return { rows, totals: totalsOf(rows), check: controlCheck(ledger, totalsOf(all).closing), leftOut: null, recon };
}

export async function tradeReceivables(tenantId: string, from: string, to: string, opts: { includeCashSale?: boolean } = {}): Promise<TradeReport> {
  const [list, lines, ledger] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId)),
    getCustomerLines(tenantId),
    controlBalance(tenantId, "1100", "debit", to),
  ]);
  const all = list.map((c) => ({ cash: isCashSaleCustomer(c.name), row: buildPartyRow({ id: c.id, name: c.name, lines: lines.get(c.id) ?? [] }, "debit", { from, to }) }));
  const shown = all.filter((x) => (opts.includeCashSale || !x.cash) && x.row.active).map((x) => x.row);
  const away = all.filter((x) => x.cash && !opts.includeCashSale);
  const leftOutClosing = Math.round(away.reduce((s, x) => s + x.row.closing, 0) * 100) / 100;
  return {
    rows: shown,
    totals: totalsOf(shown),
    check: controlCheck(ledger, totalsOf(all.map((x) => x.row)).closing),
    leftOut: away.some((x) => x.row.active) ? { label: "Cash Sale (walk-in customers)", closing: leftOutClosing } : null,
    recon: null,
  };
}
