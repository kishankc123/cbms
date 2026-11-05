import { slabBreakdown, slabTax, type Slab, type TaxpayerClass } from "@/lib/compliance/slab-tables";
import { retirementDeduction, sstExemption, type PayrollRules, type RetirementDeduction } from "./retirement-rules";

// The arithmetic of salary TDS (no database). Tax is on the year's income, so each month's TDS is a projection: the income expected for the whole
// fiscal year goes through the slabs, what has already been withheld is taken off, and the rest is split over the months still to come (this one
// included). A raise, a bonus or a slab change in a later month changes the projection, so the remaining months adjust by themselves; the last
// month clears what is left.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rounds an amount by the organization's payroll rounding rule (none, nearest, up or down). */
export function applyRounding(rule: string, n: number): number {
  return rule === "nearest" ? Math.round(n) : rule === "up" ? Math.ceil(n - 1e-9) : rule === "down" ? Math.floor(n + 1e-9) : round2(n);
}

/** Everything behind one month's TDS, kept on the payroll line so the payslip can always be explained. */
export type TdsWorking = {
  taxpayerClass: TaxpayerClass;
  /** True when the employee had no tax status and Single was used. */
  classAssumed: boolean;
  slabVersion: { id: string; label: string } | null;
  /** "slabs" when none are published for the pay date: no TDS was taken. */
  missing: "slabs" | null;
  taxablePay: number;
  earnedBefore: number;
  priorIncome: number;
  /** Months still to come in the fiscal year, this one included. */
  monthsLeft: number;
  projected: number;
  breakdown: { from: number; to: number | null; rate: number; amount: number; tax: number }[];
  annualTax: number;
  withheldBefore: number;
  priorTds: number;
  stillToWithhold: number;
  tds: number;
  /** Retirement savings that reduced taxable income this year (after the limits), and what the limits were. Absent on lines made before retirement schemes existed. */
  retirementActual?: number;
  retirementDeduction?: number;
  retirementLimitedBy?: RetirementDeduction["limitedBy"];
  /** The projected income the slabs were applied to (projected pay less the retirement deduction). */
  taxableIncome?: number;
  /** Tax waived for an employee confirmed for the first-band exemption. */
  sstExemption?: number;
};

export type TdsInput = {
  /** The year's retirement savings (employee SSF, PF and CIT, as the rules count them) and the limits on the deduction. Omit for no deduction. */
  retirement?: { actualAnnual: number; limits: PayrollRules["retirementDeduction"] };
  /** How many of the lowest slabs are waived for this employee; 0 or omitted when not confirmed eligible. */
  sstExemptBands?: number;
  taxablePay: number;
  earnedBefore: number;
  withheldBefore: number;
  priorIncome: number;
  priorTds: number;
  monthsLeft: number;
  slabs: Slab[] | null;
  rounding: string;
};

export function computeMonthlyTds(i: TdsInput): Omit<TdsWorking, "taxpayerClass" | "classAssumed" | "slabVersion"> {
  const monthsLeft = Math.max(i.monthsLeft, 1);
  const projected = round2(i.priorIncome + i.earnedBefore + i.taxablePay * monthsLeft);
  const base = { missing: null, taxablePay: round2(i.taxablePay), earnedBefore: round2(i.earnedBefore), priorIncome: round2(i.priorIncome), monthsLeft, projected, withheldBefore: round2(i.withheldBefore), priorTds: round2(i.priorTds) };
  if (!i.slabs) return { ...base, missing: "slabs", breakdown: [], annualTax: 0, stillToWithhold: 0, tds: 0 };
  const deduction = i.retirement ? retirementDeduction(i.retirement.actualAnnual, projected, i.retirement.limits) : null;
  const taxableIncome = round2(Math.max(projected - (deduction?.allowed ?? 0), 0));
  const waived = Math.min(sstExemption(i.slabs, taxableIncome, i.sstExemptBands ?? 0), slabTax(i.slabs, taxableIncome));
  const annualTax = round2(slabTax(i.slabs, taxableIncome) - waived);
  const stillToWithhold = round2(Math.max(annualTax - i.withheldBefore - i.priorTds, 0));
  const extra = i.retirement || waived > 0 ? { retirementActual: round2(i.retirement?.actualAnnual ?? 0), retirementDeduction: deduction?.allowed ?? 0, retirementLimitedBy: deduction?.limitedBy ?? "none", taxableIncome, sstExemption: waived } : {};
  return { ...base, ...extra, breakdown: slabBreakdown(i.slabs, taxableIncome), annualTax, stillToWithhold, tds: Math.max(applyRounding(i.rounding, stillToWithhold / monthsLeft), 0) };
}

