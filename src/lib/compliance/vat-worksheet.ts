// The VAT worksheet, shown one fiscal year at a time (the year is chosen from a drop-down). One row per filing period (whatever
// period the organization's VAT obligations were generated at — monthly or quarterly). Only a VAT receivable (credit) is carried
// forward — from period to period and from one fiscal year to the next — and is netted off against a later period's VAT payable.
// VAT payable is never carried: what is unpaid stays with its own period (fines and penalties are on the Fines & Penalties screen,
// not here). Sales and purchase figures are already net of returns (see getVatReturn).
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations } from "@/db/schema";
import { obligationAmounts } from "./tax-amounts";
import { getVatReturn } from "./reports";
import { bsFiscalYearOf, yearRange, todayIso, type IsoDate } from "@/lib/calendar";

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
  /** VAT on sales - VAT on purchases for the period. Negative = a receivable (credit) for the period. */
  netPay: number;
  /** VAT receivable brought forward into this period (from earlier periods and earlier fiscal years). */
  creditOpening: number;
  /** The part of that receivable netted off against this period's payable. */
  creditUsed: number;
  /** VAT receivable carried to the next period: opening - used + this period's own credit. */
  creditClosing: number;
  /** VAT payable for the period after the receivable has been netted off. */
  netPayable: number;
  paid: number;
  /** VAT payable still unpaid. Not carried forward — it stays with this period. */
  pendingVat: number;
  /** Filed (and settled) before the organization started using the system: nothing is owed. */
  filedBeforeSystem: boolean;
};

export type VatWorksheetYear = { key: string; label: string; from: string; to: string };

export type VatWorksheet = {
  today: IsoDate;
  years: VatWorksheetYear[];
  selectedKey: string | null;
  rows: VatWorksheetRow[];
  /** VAT receivable carried in from earlier years at the start of the selected year (the "opening balance b/f" row). */
  openingCredit: number;
  /** VAT payable still unpaid: this year's periods plus periods of earlier years (payable is never carried, so it is added here). */
  payableVat: number;
};

function fiscalYearOfDate(iso: string): VatWorksheetYear {
  const fy = bsFiscalYearOf(iso);
  if (fy) return { key: fy.from, label: fy.label, from: fy.from, to: fy.to };
  const y = yearRange("AD", iso);
  return { key: y.from, label: y.from.slice(0, 4), from: y.from, to: y.to };
}

export async function getVatWorksheet(tenantId: string, requestedKey?: string | null): Promise<VatWorksheet> {
  const today = todayIso();

  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.categoryKey, "tax"), eq(complianceObligations.taxTypeKey, "vat"), ne(complianceObligations.status, "not_applicable")))
    .orderBy(asc(complianceObligations.periodStart), asc(complianceObligations.dueDate));

  const withPeriods = obligations.filter((o) => o.periodStart && o.periodEnd); // hand-entered items with no period don't belong in the worksheet

  // The years on offer come from the periods alone (no figures needed), so the year is chosen before the costly part.
  const periodYears = withPeriods.map((o) => fiscalYearOfDate(o.periodStart!));
  const years = Array.from(new Map(periodYears.map((y) => [y.key, y])).values()).sort((a, b) => (a.key < b.key ? -1 : 1));
  const current = fiscalYearOfDate(today).key;
  const selected = years.find((y) => y.key === requestedKey) ?? years.find((y) => y.key === current) ?? years[years.length - 1] ?? null;

  // Figures are worked out only up to the end of the selected year: later years change nothing in it.
  const upTo = withPeriods.map((o, i) => ({ o, year: periodYears[i] })).filter((p) => selected && p.year.key <= selected.key);
  const [amounts, returns] = await Promise.all([
    obligationAmounts(tenantId, obligations),
    Promise.all(upTo.map((p) => getVatReturn(tenantId, p.o.periodStart!, p.o.periodEnd!))),
  ]);

  // The receivable chain runs through every period from the start, so the selected year opens with the right brought-forward credit.
  let credit = 0;
  const all = upTo.map(({ o, year }, i) => {
    const ret = returns[i];
    const netPay = ret.netVatPayable;
    const creditOpening = credit;
    const creditUsed = Math.min(creditOpening, Math.max(0, netPay));
    const creditClosing = round2(creditOpening - creditUsed + Math.max(0, -netPay));
    const netPayable = round2(Math.max(0, netPay) - creditUsed);
    credit = creditClosing;
    // A period filed before the system was settled outside it, so what it came to counts as paid.
    const paid = o.filedBeforeSystem ? netPayable : amounts.get(o.id)?.paid ?? 0;
    const pendingVat = round2(Math.max(0, netPayable - paid));
    const row: VatWorksheetRow = {
      obligationId: o.id,
      periodLabel: o.periodLabel,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      dueDate: o.dueDate,
      netSales: ret.salesTaxable,
      salesVat: ret.outputVat,
      netPurchase: ret.purchasesTaxable,
      purchaseVat: ret.inputVat,
      netPay,
      creditOpening,
      creditUsed,
      creditClosing,
      netPayable,
      paid,
      pendingVat,
      filedBeforeSystem: o.filedBeforeSystem,
    };
    return { row, year };
  });

  const inYear = all.filter((c) => selected && c.year.key === selected.key).map((c) => c.row);
  const earlier = all.filter((c) => selected && c.year.key < selected.key).map((c) => c.row);

  return {
    today,
    years,
    selectedKey: selected?.key ?? null,
    rows: inYear,
    openingCredit: inYear[0]?.creditOpening ?? 0,
    payableVat: round2([...earlier, ...inYear].reduce((sum, r) => sum + r.pendingVat, 0)),
  };
}
