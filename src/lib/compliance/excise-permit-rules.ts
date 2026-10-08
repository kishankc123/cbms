import { bsFiscalYearOf, bsFiscalYearRange, daysInMonth, isoFromYmd, ymdOf, type IsoDate } from "@/lib/calendar";
import { permitPenalty, toPercent, type PermitAction, type PermitRenewalParams } from "./penalty-types";

// The excise permit: valid for one Nepali fiscal year (Shrawan to Ashadh) at a time, whatever date it was first issued or paid
// on. The renewal for the next year falls due in Shrawan; after Shrawan it is late, and a fine on the standard renewal fee
// grows by band. Pure: no database, so the dates and bands can be tested exactly.

export type PermitState = "active" | "renewal_window" | "expired";

export type PermitInput = {
  today: IsoDate;
  /** The permit date (the excise registration's "Effective from"). The fiscal year it falls in counts as paid for. */
  permitDate: IsoDate;
  /** The fiscal years (by the BS year they start in) a renewal has been recorded for. */
  renewedYears: number[];
  /** The company's own standard annual renewal fee; the fine is a share of it. */
  standardFee: number | null;
  /** The late-renewal bands in force on the deadline, if any are set. */
  rule: PermitRenewalParams | null;
};

export type PermitStatus = {
  state: PermitState;
  /** The last fiscal year paid for, e.g. "2083/84". */
  coveredThrough: string;
  coveredThroughYear: number;
  /** The permit is valid until the end of Ashadh of that year. */
  validUntil: IsoDate;
  /** The fiscal year whose renewal is (or next will be) due, and the last day to renew it (end of Shrawan). */
  renewalFor: { startYear: number; label: string; opens: IsoDate; deadline: IsoDate };
  /** Whole BS months after Shrawan, counted from the first unpaid fiscal year's deadline; 0 when not late. */
  monthsLate: number;
  /** In penalty mode: the band, the fine on the standard fee (null when the fee or the bands are not known), and the action. */
  penalty: { action: PermitAction; rate: number; fine: number | null } | null;
  /** Every fiscal year that is overdue for renewal, oldest first. */
  unpaidYears: number[];
  /** True when the delay has reached the band that cancels the permit: operating without a licence. */
  cancelled: boolean;
};

const SHRAWAN = 4;

/** The last day of Shrawan in the BS year the fiscal year starts in. */
export function shrawanDeadline(startYear: number): IsoDate {
  const last = daysInMonth("BS", startYear, SHRAWAN) ?? 30;
  return isoFromYmd("BS", { year: startYear, month: SHRAWAN, day: last })!;
}

export function permitStatus(i: PermitInput): PermitStatus | null {
  const todayFy = bsFiscalYearOf(i.today);
  const permitFy = bsFiscalYearOf(i.permitDate);
  const todayBs = ymdOf("BS", i.today);
  if (!todayFy || !permitFy || !todayBs) return null;

  const coveredYear = Math.max(permitFy.startYear, ...i.renewedYears);
  const coveredRange = bsFiscalYearRange(coveredYear)!;
  const nextYear = coveredYear + 1;
  const nextRange = bsFiscalYearRange(nextYear);
  const renewalFor = { startYear: nextYear, label: nextRange?.label ?? String(nextYear), opens: nextRange?.from ?? coveredRange.to, deadline: shrawanDeadline(nextYear) };

  const base = { coveredThrough: coveredRange.label, coveredThroughYear: coveredYear, validUntil: coveredRange.to, renewalFor, unpaidYears: [] as number[], penalty: null, cancelled: false };
  if (coveredYear >= todayFy.startYear) return { ...base, state: "active", monthsLate: 0 };

  const unpaid: number[] = [];
  for (let y = nextYear; y <= todayFy.startYear; y++) unpaid.push(y);
  if (i.today <= renewalFor.deadline) return { ...base, state: "renewal_window", monthsLate: 0, unpaidYears: unpaid };

  // Late: counted in BS months after Shrawan of the first unpaid year (Bhadra is month 1).
  const monthsLate = todayBs.year * 12 + todayBs.month - (nextYear * 12 + SHRAWAN);
  const hit = i.rule ? permitPenalty(i.rule, monthsLate, i.standardFee ?? 0) : null;
  const penalty = hit ? { action: hit.tier.action, rate: hit.tier.rate, fine: i.standardFee === null ? null : hit.fine } : null;
  return { ...base, state: "expired", monthsLate, penalty, unpaidYears: unpaid, cancelled: penalty?.action === "cancelled" };
}

/** What to tell the business, in a sentence or two. */
export function permitMessage(s: PermitStatus): string {
  if (s.state === "active") return `The permit is paid up through fiscal year ${s.coveredThrough} and valid until the end of Ashadh. Renewal for ${s.renewalFor.label} opens on Shrawan 1.`;
  if (s.state === "renewal_window") return `Renewal for fiscal year ${s.renewalFor.label} is due now. Pay the annual fee at the Inland Revenue Office by the end of Shrawan to keep the permit valid.`;
  const late = `The renewal for ${s.renewalFor.label} is ${s.monthsLate} month${s.monthsLate === 1 ? "" : "s"} late.`;
  const fine = !s.penalty ? "A late renewal fine applies: confirm the amount with the Inland Revenue Office." : s.penalty.fine === null ? `A late renewal fine of ${toPercent(s.penalty.rate)}% of the standard renewal fee applies. Enter the standard renewal fee to see the amount.` : `A late renewal fine of ${toPercent(s.penalty.rate)}% of the standard fee applies: Rs ${s.penalty.fine.toLocaleString("en-US")}.`;
  if (s.cancelled) return `${late} The permit is cancelled by the delay: operating without a licence. ${fine} Excisable goods must not be removed or sold until the permit is renewed.`;
  if (s.penalty?.action === "severe") return `${late} Severe non-compliance. ${fine} Excisable goods must not be removed or sold until the permit is renewed.`;
  return `${late} The permit has lapsed, so removing or selling excisable goods is restricted until it is renewed. ${fine}`;
}
