import { AD_MONTHS, BS_MONTHS, type CalendarSystem } from "@/lib/calendar";

/** "Ashwin 2083" / "September 2026" -> its calendar, year and month. Anything else -> null. */
export function parsePeriodLabel(label: string): { calendar: CalendarSystem; year: number; month: number } | null {
  const m = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(label);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const bs = BS_MONTHS.findIndex((n) => n.toLowerCase() === name);
  if (bs >= 0) return { calendar: "BS", year: +m[2], month: bs + 1 };
  const ad = AD_MONTHS.findIndex((n) => n.toLowerCase() === name);
  return ad >= 0 ? { calendar: "AD", year: +m[2], month: ad + 1 } : null;
}
