import { bsFiscalYearOf, yearRange } from "@/lib/calendar";

export type FiscalYearOf = { key: string; label: string; from: string; to: string };

/** The fiscal year a date falls in: Nepal's Shrawan-Ashadh year (keyed by its real AD start date) or, outside the BS table, the calendar year. */
export function fiscalYearOfDate(iso: string): FiscalYearOf {
  const fy = bsFiscalYearOf(iso);
  if (fy) return { key: fy.from, label: fy.label, from: fy.from, to: fy.to };
  const y = yearRange("AD", iso);
  return { key: y.from, label: y.from.slice(0, 4), from: y.from, to: y.to };
}
