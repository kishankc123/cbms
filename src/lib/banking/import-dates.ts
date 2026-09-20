import { classifyDate, convertAll, detectCalendar, type CalendarSystem, type Detection, type IsoDate } from "@/lib/calendar";

// Date handling for imported files (bank statements today; sales/purchase
// imports when they exist). The file may hold AD or BS dates; either way the
// only thing that leaves this module is a canonical AD ISO date.

export type ImportDateChoice = "auto" | CalendarSystem;

export type ImportDateRow = {
  /** 1-based data row number, as the user sees it in their file (header = row 1). */
  rowNumber: number;
  raw: string;
  /** Canonical AD date, or null when it could not be resolved. */
  iso: IsoDate | null;
  status: CalendarSystem | "ambiguous" | "invalid";
  note?: string;
  projected: boolean;
  dayMonthAmbiguous: boolean;
};

export type ImportDateResult = {
  choice: ImportDateChoice;
  /** What the file looks like, independent of the user's choice. */
  detected: Detection["calendar"];
  confidence: number;
  /** The calendar every row was converted under (null when rows were resolved one by one). */
  applied: CalendarSystem | null;
  rows: ImportDateRow[];
  counts: { AD: number; BS: number; ambiguous: number; invalid: number };
  /** Rows that cannot be imported as they stand (ambiguous ones block; invalid ones are skipped). */
  problemCount: number;
  /** Auto-detect found both AD and BS dates in the same column. */
  mixed: boolean;
  /** True while the import must not proceed (ambiguous rows, or mixed dates not yet accepted). */
  blocking: boolean;
  headerHint: CalendarSystem | null;
  hasProjected: boolean;
  hasDayMonthAmbiguity: boolean;
};

export function resolveImportDates(
  values: (string | null | undefined)[],
  opts: { header?: string; choice?: ImportDateChoice; dayFirst?: boolean; allowMixed?: boolean; today?: IsoDate } = {}
): ImportDateResult {
  const choice = opts.choice ?? "auto";
  const dayFirst = opts.dayFirst ?? true;
  const detection = detectCalendar(values, { header: opts.header, dayFirst, today: opts.today });
  const perRow = values.map((v, i) => classifyDate(v, i, { header: opts.header, dayFirst, today: opts.today }));

  let applied: CalendarSystem | null = null;
  let rows: ImportDateRow[];

  if (choice === "AD" || choice === "BS") {
    applied = choice;
    rows = convertAll(values, choice, { dayFirst }).map((c) => {
      const seen = perRow[c.index];
      const contradicts = c.iso !== null && (seen.calendar === "AD" || seen.calendar === "BS") && seen.calendar !== choice;
      return {
        rowNumber: c.index + 2,
        raw: c.raw,
        iso: c.iso,
        status: c.iso ? choice : "invalid",
        note: c.error ?? (contradicts ? `Looks like a ${seen.calendar} date` : undefined),
        projected: c.projected,
        dayMonthAmbiguous: c.dayMonthAmbiguous,
      };
    });
  } else if (detection.calendar === "AD" || detection.calendar === "BS") {
    // One calendar throughout; day/month-ambiguous rows follow the column.
    applied = detection.calendar;
    rows = convertAll(values, applied, { dayFirst }).map((c) => ({
      rowNumber: c.index + 2,
      raw: c.raw,
      iso: c.iso,
      status: c.iso ? applied! : "invalid",
      note: c.error ?? undefined,
      projected: c.projected,
      dayMonthAmbiguous: c.dayMonthAmbiguous,
    }));
  } else {
    // Mixed / undecidable: keep each row's own verdict so the user can see exactly which are which.
    rows = perRow.map((r) => ({
      rowNumber: r.index + 2,
      raw: r.raw,
      iso: r.calendar === "AD" || r.calendar === "BS" ? r.iso : null,
      status: r.calendar,
      note: r.note,
      projected: r.projected,
      dayMonthAmbiguous: r.dayMonthAmbiguous,
    }));
  }

  // Blank cells are not data rows — the row importer skips them, so they are not "problems".
  const relevant = rows.filter((r) => r.raw.trim() !== "");
  const counts = { AD: 0, BS: 0, ambiguous: 0, invalid: 0 };
  for (const r of relevant) counts[r.status]++;
  const problemCount = counts.ambiguous + counts.invalid;
  const mixed = choice === "auto" && detection.calendar === "mixed";

  return {
    choice,
    detected: detection.calendar,
    confidence: detection.confidence,
    applied,
    rows,
    counts,
    problemCount,
    mixed,
    // Invalid rows (e.g. a "Total" footer) are skipped and reported; undecidable or mixed dates stop the import until the user chooses.
    blocking: counts.ambiguous > 0 || (mixed && !opts.allowMixed) || (choice === "auto" && detection.calendar === "none"),
    headerHint: detection.headerHint,
    hasProjected: relevant.some((r) => r.projected),
    hasDayMonthAmbiguity: relevant.some((r) => r.dayMonthAmbiguous),
  };
}
