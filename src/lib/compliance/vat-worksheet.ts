// The VAT worksheet, shown one fiscal year at a time (the year is chosen from a drop-down). One row per filing period (whatever
// period the organization's VAT obligations were generated at — monthly or quarterly). Only a VAT receivable (credit) is carried
// forward — from period to period and from one fiscal year to the next — and is netted off against a later period's VAT payable.
// VAT payable is never carried: what is unpaid stays with its own period (fines and penalties are on the Fines & Penalties screen,
// not here). Sales and purchase figures are already net of returns (see getVatReturn).
//
// Working the figures out from the books is the slow part, so it is done only when the person loads the worksheet, and the result
// is saved (see vat-worksheet-store.ts). Showing a worksheet needs no ledger reads: the receivable chain inside the year is plain
// arithmetic on the saved figures, and what has been paid is read live from the payments.
import { and, asc, eq, gt, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, journalEntries, paymentAllocations, payments, vatWorksheets } from "@/db/schema";
import type { VatWorksheetFigures, VatWorksheetPeriodFigures } from "@/db/schema/vat-worksheet";
import { getVatReturn } from "./reports";
import { bsFiscalYearOf, yearRange, todayIso } from "@/lib/calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type VatWorksheetRow = {
  obligationId: string;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  /** Sales less sales returns (taxable value). */
  netSales: number;
  /** VAT on sales, less VAT on sales returns. */
  salesVat: number;
  /** Purchases (and VAT-bearing expenses) less purchase returns (taxable value). */
  netPurchase: number;
  /** VAT on purchases, less VAT on purchase returns. */
  purchaseVat: number;
  /** VAT on sales - VAT on purchases. Positive = VAT payable; negative = VAT receivable. */
  netPay: number;
  /** VAT receivable brought forward into this period (from earlier periods and earlier fiscal years). */
  creditOpening: number;
  /** The part of that receivable netted off against this period's payable. */
  creditUsed: number;
  /** VAT receivable carried to the next period: opening - used + this period's own credit. */
  creditClosing: number;
  /** VAT payable for the period after the receivable has been netted off. */
  netPayable: number;
  /** The period's closing balance: positive = VAT payable (booked for the period, never carried), negative = VAT receivable (carried to the next period). */
  closing: number;
  paid: number;
  /** VAT payable still unpaid. Not carried forward — it stays with this period. */
  pendingVat: number;
  /** Filed (and settled) before the organization started using the system: nothing is owed. */
  filedBeforeSystem: boolean;
};

export type VatWorksheetYear = { key: string; label: string; from: string; to: string };

export type VatWorksheet = {
  rows: VatWorksheetRow[];
  /** VAT receivable carried in from earlier years at the start of the year (the "opening balance b/f" row). */
  openingCredit: number;
  /** VAT payable still unpaid: this year's periods plus periods of earlier years (payable is never carried, so it is added here). */
  payableVat: number;
};

export function fiscalYearOfDate(iso: string): VatWorksheetYear {
  const fy = bsFiscalYearOf(iso);
  if (fy) return { key: fy.from, label: fy.label, from: fy.from, to: fy.to };
  const y = yearRange("AD", iso);
  return { key: y.from, label: y.from.slice(0, 4), from: y.from, to: y.to };
}

async function vatObligations(tenantId: string) {
  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.categoryKey, "tax"), eq(complianceObligations.taxTypeKey, "vat"), ne(complianceObligations.status, "not_applicable")))
    .orderBy(asc(complianceObligations.periodStart), asc(complianceObligations.dueDate));
  return obligations.filter((o) => o.periodStart && o.periodEnd); // hand-entered items with no period don't belong in the worksheet
}

/** The fiscal years that have VAT periods, and the one to open first (the current year, else the latest). Cheap: no ledger reads. */
export async function listVatWorksheetYears(tenantId: string, requestedKey?: string | null) {
  const periods = await vatObligations(tenantId);
  const years = Array.from(new Map(periods.map((o) => fiscalYearOfDate(o.periodStart!)).map((y) => [y.key, y])).values()).sort((a, b) => (a.key < b.key ? -1 : 1));
  const current = fiscalYearOfDate(todayIso()).key;
  const selected = years.find((y) => y.key === requestedKey) ?? years.find((y) => y.key === current) ?? years[years.length - 1] ?? null;
  return { years, selected };
}

/**
 * Works the selected year's figures out from the books: every period up to the end of that year (the receivable chain needs the
 * earlier ones). This is the slow part — it reads the VAT return of each period — so it runs only when the worksheet is loaded.
 */
export async function computeVatWorksheetFigures(tenantId: string, year: VatWorksheetYear): Promise<VatWorksheetFigures> {
  const periods = await vatObligations(tenantId);
  const upTo = periods.map((o) => ({ o, year: fiscalYearOfDate(o.periodStart!) })).filter((p) => p.year.key <= year.key);
  const returns = await Promise.all(upTo.map((p) => getVatReturn(tenantId, p.o.periodStart!, p.o.periodEnd!)));
  const paid = await paidByObligation(tenantId, upTo.map((p) => p.o.id));

  let credit = 0;
  let openingCredit = 0;
  const figures: VatWorksheetPeriodFigures[] = [];
  const earlierPayable: VatWorksheetFigures["earlierPayable"] = [];
  upTo.forEach(({ o, year: y }, i) => {
    const netPay = returns[i].netVatPayable;
    const used = Math.min(credit, Math.max(0, netPay));
    const netPayable = round2(Math.max(0, netPay) - used);
    if (y.key === year.key) {
      if (figures.length === 0) openingCredit = credit;
      figures.push({
        obligationId: o.id,
        periodLabel: o.periodLabel,
        periodStart: o.periodStart!,
        periodEnd: o.periodEnd!,
        dueDate: o.dueDate,
        netSales: returns[i].salesTaxable,
        salesVat: returns[i].outputVat,
        netPurchase: returns[i].purchasesTaxable,
        purchaseVat: returns[i].inputVat,
      });
    } else if (!o.filedBeforeSystem && netPayable > (paid.get(o.id) ?? 0)) {
      earlierPayable.push({ obligationId: o.id, netPayable });
    }
    credit = round2(credit - used + Math.max(0, -netPay));
  });
  return { openingCredit, periods: figures, earlierPayable };
}

/** What has been paid against each VAT obligation (voided payments excluded). */
export async function paidByObligation(tenantId: string, obligationIds: string[]): Promise<Map<string, number>> {
  if (obligationIds.length === 0) return new Map();
  const rows = await db
    .select({ id: paymentAllocations.targetId, total: sql<string>`sum(${paymentAllocations.allocatedAmount})` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(paymentAllocations.targetType, "tax_obligation"), inArray(paymentAllocations.targetId, obligationIds), ne(payments.status, "voided")))
    .groupBy(paymentAllocations.targetId);
  return new Map(rows.map((r) => [r.id, round2(Number(r.total))]));
}

/** The receivable chain over a year's frozen figures: what each period nets off, owes and carries. Plain arithmetic, no database. */
export function chainPeriods(figures: VatWorksheetFigures) {
  let credit = figures.openingCredit;
  return figures.periods.map((p) => {
    const netPay = round2(p.salesVat - p.purchaseVat);
    const creditOpening = credit;
    const creditUsed = Math.min(creditOpening, Math.max(0, netPay));
    const creditClosing = round2(creditOpening - creditUsed + Math.max(0, -netPay));
    const netPayable = round2(Math.max(0, netPay) - creditUsed);
    credit = creditClosing;
    return { p, netPay, creditOpening, creditUsed, creditClosing, netPayable };
  });
}

/**
 * VAT payable of each period of every SAVED worksheet, after the carried receivable is netted off (obligation id -> amount). The
 * Overview uses it so that a month's amount due is its worksheet closing balance; a year that has not been saved is not in it.
 */
export async function savedVatNetPayables(tenantId: string): Promise<Map<string, number>> {
  const rows = await db.select({ data: vatWorksheets.data }).from(vatWorksheets).where(and(eq(vatWorksheets.tenantId, tenantId), isNotNull(vatWorksheets.data)));
  const out = new Map<string, number>();
  for (const r of rows) for (const c of chainPeriods(r.data!)) out.set(c.p.obligationId, c.netPayable);
  return out;
}

/** The worksheet as shown: frozen sales and purchase figures, with the receivable chain and what has been paid worked out on the spot. */
export async function buildVatWorksheet(tenantId: string, figures: VatWorksheetFigures): Promise<VatWorksheet> {
  const ids = [...figures.periods.map((p) => p.obligationId), ...figures.earlierPayable.map((p) => p.obligationId)];
  const [paid, obligations] = await Promise.all([
    paidByObligation(tenantId, ids),
    ids.length ? db.select({ id: complianceObligations.id, filedBeforeSystem: complianceObligations.filedBeforeSystem }).from(complianceObligations).where(and(eq(complianceObligations.tenantId, tenantId), inArray(complianceObligations.id, ids))) : Promise.resolve([]),
  ]);
  const filedBefore = new Map(obligations.map((o) => [o.id, o.filedBeforeSystem]));

  const rows: VatWorksheetRow[] = chainPeriods(figures).map(({ p, netPay, creditOpening, creditUsed, creditClosing, netPayable }) => {
    const filedBeforeSystem = filedBefore.get(p.obligationId) ?? false;
    // A period filed before the system was settled outside it, so what it came to counts as paid.
    const paidAmount = filedBeforeSystem ? netPayable : paid.get(p.obligationId) ?? 0;
    return {
      obligationId: p.obligationId,
      periodLabel: p.periodLabel,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      dueDate: p.dueDate,
      netSales: p.netSales,
      salesVat: p.salesVat,
      netPurchase: p.netPurchase,
      purchaseVat: p.purchaseVat,
      netPay,
      creditOpening,
      creditUsed,
      creditClosing,
      netPayable,
      closing: netPayable > 0 ? netPayable : creditClosing > 0 ? round2(-creditClosing) : 0,
      paid: paidAmount,
      pendingVat: round2(Math.max(0, netPayable - paidAmount)),
      filedBeforeSystem,
    };
  });
  const earlierPending = figures.earlierPayable.reduce((sum, e) => sum + Math.max(0, e.netPayable - (paid.get(e.obligationId) ?? 0)), 0);
  return { rows, openingCredit: figures.openingCredit, payableVat: round2(earlierPending + rows.reduce((sum, r) => sum + r.pendingVat, 0)) };
}

/** Whether sales, purchases or expenses were posted after `since` that fall in or before the year — so a saved worksheet is out of date. */
export async function vatBooksChangedSince(tenantId: string, year: VatWorksheetYear, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        inArray(journalEntries.sourceType, ["sale", "purchase", "expense", "sales_return", "purchase_return", "asset_purchase", "asset_disposal"]),
        lte(journalEntries.entryDate, year.to),
        gt(journalEntries.createdAt, since)
      )
    )
    .limit(1);
  return rows.length > 0;
}
