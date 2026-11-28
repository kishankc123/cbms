// How a purchase document divides for the VAT figures: what carried VAT (the "net purchase" of the VAT return), what was zero-rated or exempt, and what was not on
// a VAT bill at all. Pure, so it is unit-tested.

import type { LineTreatment } from "./vat-lines";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100 + 0;

export type VatSplit = {
  /** Value before VAT that VAT was charged on. */
  taxable: number;
  zeroRated: number;
  exempt: number;
  /** PAN, estimate, challan or no-bill purchases: outside the VAT return. */
  noVatBill: number;
};

export type SplitLine = { rate: number; quantity: number; discount: number; taxTreatment?: LineTreatment | null };

export const EMPTY_SPLIT: VatSplit = { taxable: 0, zeroRated: 0, exempt: 0, noVatBill: 0 };

export const addSplit = (a: VatSplit, b: VatSplit, sign: 1 | -1 = 1): VatSplit => ({
  taxable: round2(a.taxable + sign * b.taxable),
  zeroRated: round2(a.zeroRated + sign * b.zeroRated),
  exempt: round2(a.exempt + sign * b.exempt),
  noVatBill: round2(a.noVatBill + sign * b.noVatBill),
});

/** A line's value before VAT: rate times quantity, less its discount (never below nothing). */
export function lineValue(l: SplitLine): number {
  const gross = round2(l.rate * l.quantity);
  return round2(gross - Math.min(Math.max(l.discount, 0), gross));
}

/**
 * A purchase bill or return. It counts as a VAT document when it is marked as a VAT bill, carries VAT, or has a line marked zero-rated or exempt (a return has no
 * bill type, and bills from before bill types existed carry only their VAT). A line with no treatment is taxable. `pendingExempt` is the non-taxable part of a
 * bill recorded by amount, which has no lines yet. The parts always add up to the subtotal.
 */
export function splitDocument(doc: { billType?: string | null; subtotal: number; taxAmount: number; lines?: readonly SplitLine[] | null; pendingExempt?: number }): VatSplit {
  const lines = doc.lines ?? [];
  const pendingExempt = round2(doc.pendingExempt ?? 0);
  const isVat = doc.billType === "vat" || doc.taxAmount > 0 || pendingExempt > 0 || lines.some((l) => l.taxTreatment && l.taxTreatment !== "taxable");
  if (!isVat) return { ...EMPTY_SPLIT, noVatBill: round2(doc.subtotal) };

  const sum = (t: LineTreatment) => round2(lines.filter((l) => l.taxTreatment === t).reduce((s, l) => s + lineValue(l), 0));
  const zeroRated = Math.min(sum("zero_rated"), round2(doc.subtotal));
  const exempt = Math.min(round2(sum("exempt") + pendingExempt), round2(doc.subtotal - zeroRated));
  return { taxable: round2(doc.subtotal - zeroRated - exempt), zeroRated, exempt, noVatBill: 0 };
}

/**
 * An expense, which has one treatment for the whole of it. One that is not on a VAT bill and carries no VAT is not a purchase for the VAT figures at all, so it
 * adds to none of them.
 */
export function splitExpense(e: { billType?: string | null; taxTreatment?: string | null; taxableAmount: number; vatAmount: number }): VatSplit {
  if (e.vatAmount > 0) return { ...EMPTY_SPLIT, taxable: round2(e.taxableAmount) };
  if (e.billType !== "vat") return { ...EMPTY_SPLIT };
  if (e.taxTreatment === "exempt") return { ...EMPTY_SPLIT, exempt: round2(e.taxableAmount) };
  if (e.taxTreatment === "zero_rated") return { ...EMPTY_SPLIT, zeroRated: round2(e.taxableAmount) };
  return { ...EMPTY_SPLIT, taxable: round2(e.taxableAmount) };
}
