import { convertADtoBS, convertBStoAD, addDays, type IsoDate } from "@/lib/calendar";
import type { TaxDepreciationRules } from "./rules";

export type TaxYear = { startYear: number; label: string; from: IsoDate; to: IsoDate };

/** The tax year (Nepal: Shrawan to Ashadh, in the Bikram Sambat calendar) that contains an English date. null when the date is outside the calendar data. */
export function taxYearOf(iso: IsoDate, rules: Pick<TaxDepreciationRules, "taxYearStartMonth">): TaxYear | null {
  const bs = convertADtoBS(iso);
  if (!bs) return null;
  return taxYearStarting(bs.month >= rules.taxYearStartMonth ? bs.year : bs.year - 1, rules);
}

/** The tax year that starts in a given Bikram Sambat year. */
export function taxYearStarting(startYear: number, rules: Pick<TaxDepreciationRules, "taxYearStartMonth">): TaxYear | null {
  const from = convertBStoAD({ year: startYear, month: rules.taxYearStartMonth, day: 1 });
  const nextFrom = convertBStoAD({ year: startYear + 1, month: rules.taxYearStartMonth, day: 1 });
  if (!from || !nextFrom) return null;
  return { startYear, label: `${startYear}/${String(startYear + 1).slice(2)}`, from, to: addDays(nextFrom, -1) };
}

/** How many thirds of an addition made on this date enter the pool in its own year (3, 2 or 1). null when the date can't be placed. */
export function timingThirds(iso: IsoDate, rules: Pick<TaxDepreciationRules, "timing">): 1 | 2 | 3 | null {
  const bs = convertADtoBS(iso);
  if (!bs) return null;
  for (const b of rules.timing) {
    const inBand = b.fromMonth <= b.toMonth ? bs.month >= b.fromMonth && bs.month <= b.toMonth : bs.month >= b.fromMonth || bs.month <= b.toMonth;
    if (inBand) return b.thirds;
  }
  return null;
}

/**
 * The date an addition counts from: the later of the day the asset entered the tax class (put into business use) and the day the cost was
 * incurred. Either may be missing; with both missing there is nothing to place.
 */
export function additionDate(enteredClass: IsoDate | null, costIncurred: IsoDate | null): IsoDate | null {
  if (enteredClass && costIncurred) return enteredClass > costIncurred ? enteredClass : costIncurred;
  return enteredClass ?? costIncurred;
}
