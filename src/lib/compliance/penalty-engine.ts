// The fine/penalty/interest math for late VAT, TDS and Excise filings — pure functions, no database. The rule
// PARAMETERS (rates, floors, caps) are versioned data (compliance_penalty_rules, looked up by effective date via
// getPenaltyRule in ./penalty-rules); this file only ever encodes the FORMULA, never a number that a government
// notice could change. Days Delayed is always whole days from the statutory due date to the actual date (0 if not late).
import type { IsoDate } from "@/lib/calendar";

export type TaxTypeKey = "vat" | "tds" | "excise";

export type VatPenaltyParams = {
  /** The daily percentage of tax payable that accrues as a filing fine each day late. */
  filingDailyRate: number;
  /** The filing fine can never be less than this, whatever the daily calculation gives (a Nil return: 0 either way). */
  filingFloor: number;
  /** Flat percentage of the tax payable charged once, whatever the delay, when payment itself is late. */
  latePaymentFlatRate: number;
  /** Simple annual interest rate on the unpaid tax. */
  interestAnnualRate: number;
};

export type TdsPenaltyParams = {
  /** Flat administrative fine per day the E-TDS filing is late. */
  filingFlatPerDay: number;
  /** Annual percentage of the withholding that accrues daily as a filing fee — alongside the flat per-day fine, not instead of it. */
  filingAnnualRate: number;
  interestAnnualRate: number;
};

export type ExcisePenaltyParams = {
  /** Percentage of duty charged for every 30-day block started (rounded up), until the cap. */
  stepUpRatePer30Days: number;
  /** The step-up fine never exceeds this share of the duty, however late. */
  stepUpCapRate: number;
  interestAnnualRate: number;
  /** The manual filing/audit override (a departmental assessment) can never exceed this share of the duty. */
  manualOverrideCapRate: number;
};

export type PenaltyParams<T extends TaxTypeKey> = T extends "vat" ? VatPenaltyParams : T extends "tds" ? TdsPenaltyParams : ExcisePenaltyParams;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whole days from the statutory due date to the actual date — never negative; on time or early is 0 days. */
export function daysDelayed(dueDate: IsoDate, actualDate: IsoDate): number {
  const toUtc = (iso: IsoDate) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d); // Date.UTC takes a 0-indexed month; the ISO string's is 1-indexed.
  };
  return Math.max(0, Math.round((toUtc(actualDate) - toUtc(dueDate)) / 86400000));
}

export type PenaltyLine = { label: string; amount: number; note?: string };
export type PenaltyBreakdown = {
  daysDelayed: number;
  principal: number;
  filingPenalty: number;
  paymentPenalty: number;
  interest: number;
  /** Principal + every penalty/interest line — the total payable liability for this charge. */
  totalPayable: number;
  lines: PenaltyLine[];
};

const zero = (principal: number): PenaltyBreakdown => ({ daysDelayed: 0, principal, filingPenalty: 0, paymentPenalty: 0, interest: 0, totalPayable: round2(principal), lines: [] });

/**
 * VAT: filing penalty is the daily calculated fine OR the floor, whichever is higher (a Nil return has a
 * calculated fine of 0, so the floor always wins — no special case needed). Late payment is a flat 10% once,
 * regardless of how many days late. Interest is simple, daily, on the principal.
 */
function calculateVat(principal: number, d: number, params: VatPenaltyParams): PenaltyBreakdown {
  if (d <= 0) return zero(principal);
  const calculatedFine = round2(principal * params.filingDailyRate * d);
  const filingPenalty = Math.max(calculatedFine, params.filingFloor);
  const paymentPenalty = round2(principal * params.latePaymentFlatRate);
  const interest = round2((principal * params.interestAnnualRate * d) / 365);
  const lines: PenaltyLine[] = [
    { label: "Calculated daily fine", amount: calculatedFine, note: `${(params.filingDailyRate * 100).toFixed(2)}%/day × ${d} days` },
    { label: "Minimum statutory floor", amount: params.filingFloor },
    { label: "Applied filing penalty", amount: filingPenalty, note: filingPenalty === params.filingFloor && calculatedFine < params.filingFloor ? "Minimum floor rate applied" : "Calculated daily fine applied" },
    { label: "Late payment penalty (flat)", amount: paymentPenalty, note: `${(params.latePaymentFlatRate * 100).toFixed(0)}% of principal` },
    { label: "Interest overdue", amount: interest, note: `${(params.interestAnnualRate * 100).toFixed(0)}% p.a.` },
  ];
  return { daysDelayed: d, principal: round2(principal), filingPenalty, paymentPenalty, interest, totalPayable: round2(principal + filingPenalty + paymentPenalty + interest), lines };
}

/** TDS: two filing components run together (flat per-day + an annual percentage of the withholding), plus interest. No separate late-payment penalty. */
function calculateTds(principal: number, d: number, params: TdsPenaltyParams): PenaltyBreakdown {
  if (d <= 0) return zero(principal);
  const flatFine = round2(params.filingFlatPerDay * d);
  const volumeFee = round2((principal * params.filingAnnualRate * d) / 365);
  const filingPenalty = round2(flatFine + volumeFee);
  const interest = round2((principal * params.interestAnnualRate * d) / 365);
  const lines: PenaltyLine[] = [
    { label: "Flat administrative fine", amount: flatFine, note: `NPR ${params.filingFlatPerDay}/day × ${d} days` },
    { label: "Transaction-volume fee", amount: volumeFee, note: `${(params.filingAnnualRate * 100).toFixed(2)}% p.a.` },
    { label: "Applied filing penalty", amount: filingPenalty },
    { label: "Interest overdue", amount: interest, note: `${(params.interestAnnualRate * 100).toFixed(0)}% p.a.` },
  ];
  return { daysDelayed: d, principal: round2(principal), filingPenalty, paymentPenalty: 0, interest, totalPayable: round2(principal + filingPenalty + interest), lines };
}

/**
 * Excise: the filing/audit penalty is a manual departmental figure (capped at a share of duty, never computed);
 * the late-payment step-up compounds every 30-day block started, capped; interest is simple, daily.
 */
function calculateExcise(principal: number, d: number, params: ExcisePenaltyParams, manualOverride: number | null): PenaltyBreakdown {
  const cap = round2(principal * params.manualOverrideCapRate);
  const filingPenalty = manualOverride === null ? 0 : round2(Math.min(Math.max(manualOverride, 0), cap));
  if (d <= 0) {
    return { ...zero(principal), filingPenalty, totalPayable: round2(principal + filingPenalty), lines: filingPenalty > 0 ? [{ label: "Filing / audit penalty (manual)", amount: filingPenalty }] : [] };
  }
  const blocks = Math.ceil(d / 30);
  const stepUpCalculated = round2(principal * params.stepUpRatePer30Days * blocks);
  const stepUpMax = round2(principal * params.stepUpCapRate);
  const paymentPenalty = Math.min(stepUpCalculated, stepUpMax);
  const interest = round2((principal * params.interestAnnualRate * d) / 365);
  const lines: PenaltyLine[] = [
    ...(filingPenalty > 0 ? [{ label: "Filing / audit penalty (manual)", amount: filingPenalty, note: `Capped at ${(params.manualOverrideCapRate * 100).toFixed(0)}% of duty` }] : []),
    { label: `Late payment step-up (${blocks} × 30-day block${blocks === 1 ? "" : "s"})`, amount: stepUpCalculated, note: `${(params.stepUpRatePer30Days * 100).toFixed(0)}% per block` },
    { label: "Applied step-up (capped)", amount: paymentPenalty, note: paymentPenalty < stepUpCalculated ? `Capped at ${(params.stepUpCapRate * 100).toFixed(0)}% of duty` : undefined },
    { label: "Interest overdue", amount: interest, note: `${(params.interestAnnualRate * 100).toFixed(0)}% p.a.` },
  ];
  return { daysDelayed: d, principal: round2(principal), filingPenalty, paymentPenalty, interest, totalPayable: round2(principal + filingPenalty + paymentPenalty + interest), lines };
}

export function calculatePenalty(taxTypeKey: TaxTypeKey, principal: number, dueDate: IsoDate, actualDate: IsoDate, params: VatPenaltyParams | TdsPenaltyParams | ExcisePenaltyParams, manualExciseOverride: number | null = null): PenaltyBreakdown {
  const p = Math.max(0, round2(principal));
  const d = daysDelayed(dueDate, actualDate);
  if (taxTypeKey === "vat") return calculateVat(p, d, params as VatPenaltyParams);
  if (taxTypeKey === "tds") return calculateTds(p, d, params as TdsPenaltyParams);
  return calculateExcise(p, d, params as ExcisePenaltyParams, manualExciseOverride);
}

