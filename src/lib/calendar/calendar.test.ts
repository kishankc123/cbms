import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import DateConverter from "@remotemerge/nepali-date-converter";
import {
  convertADtoBS,
  convertBStoAD,
  formatDate,
  parseDate,
  detectCalendar,
  convertAll,
  monthRange,
  addMonths,
  presetRange,
  bsFiscalYearRange,
  bsFiscalYearOf,
  todayIso,
  isProjectedBs,
  monthCells,
  dataStatus,
  VERIFIED_THROUGH_BS_YEAR,
} from "./index";
import { bsDaysInMonth, BS_MIN_YEAR } from "./bs-data";

const require = createRequire(import.meta.url);
const NepaliDate = (require("nepali-date-converter").default ?? require("nepali-date-converter")) as new (d: Date) => { getYear(): number; getMonth(): number; getDate(): number };
const bikram = require("bikram-sambat") as { toBik(d: Date): { year: number; month: number; day: number } };

const pad = (n: number) => String(n).padStart(2, "0");
const ymdStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const allDays = (fromUtc: number, toUtc: number) => {
  const out: string[] = [];
  for (let t = fromUtc; t <= toUtc; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

describe("conversion engine", () => {
  it("matches known dates", () => {
    expect(convertADtoBS("2026-09-20")).toEqual({ year: 2083, month: 6, day: 4 });
    expect(convertBStoAD({ year: 2083, month: 6, day: 4 })).toBe("2026-09-20");
    expect(convertADtoBS("1943-04-14")).toEqual({ year: 2000, month: 1, day: 1 });
    expect(convertBStoAD({ year: 2083, month: 5, day: 1 })).toBe("2026-08-17");
  });

  it("round-trips every day in the supported range (AD -> BS -> AD)", () => {
    const { adMin, adMax } = dataStatus();
    for (const iso of allDays(Date.parse(adMin), Date.parse(adMax))) {
      const bs = convertADtoBS(iso);
      expect(bs, iso).not.toBeNull();
      expect(convertBStoAD(bs!), iso).toBe(iso);
    }
  });

  it("rejects dates outside the table and impossible BS dates", () => {
    expect(convertADtoBS("1943-04-13")).toBeNull();
    expect(convertADtoBS("2999-01-01")).toBeNull();
    expect(convertBStoAD({ year: 2083, month: 6, day: 32 })).toBeNull();
    expect(convertBStoAD({ year: 2083, month: 13, day: 1 })).toBeNull();
    expect(convertBStoAD({ year: 1999, month: 1, day: 1 })).toBeNull();
  });
});

// The safeguard that keeps the calendar honest across library updates. Three
// independent packages must agree on every day up to VERIFIED_THROUGH_BS_YEAR.
// If a Dependabot upgrade changes the data, this suite fails and shows what
// changed instead of silently shifting accounting dates.
describe("cross-checked against independent libraries", () => {
  const endOfVerified = (() => {
    const last = bsDaysInMonth(VERIFIED_THROUGH_BS_YEAR, 12)!;
    return Date.parse(convertBStoAD({ year: VERIFIED_THROUGH_BS_YEAR, month: 12, day: last })!);
  })();
  const start = Date.UTC(1943, 3, 14);

  it("agrees with nepali-date-converter, @remotemerge/nepali-date-converter and bikram-sambat through the verified horizon", () => {
    const disagreements: string[] = [];
    for (const iso of allDays(start, endOfVerified)) {
      const ours = convertADtoBS(iso)!;
      const o = ymdStr(ours.year, ours.month, ours.day);
      const a = new NepaliDate(new Date(iso + "T00:00:00Z"));
      const b = new DateConverter(iso).toBs();
      const c = bikram.toBik(new Date(iso + "T00:00:00Z"));
      const sources = { ndc: ymdStr(a.getYear(), a.getMonth() + 1, a.getDate()), remotemerge: ymdStr(b.year, b.month, b.date), bikram: ymdStr(c.year, c.month, c.day) };
      for (const [name, v] of Object.entries(sources)) if (v !== o) disagreements.push(`${iso}: ours ${o} vs ${name} ${v}`);
      if (disagreements.length > 5) break;
    }
    expect(disagreements).toEqual([]);
  });

  it("VERIFIED_THROUGH_BS_YEAR is neither stale nor optimistic", () => {
    const agreeThrough = (() => {
      let horizon = BS_MIN_YEAR - 1;
      for (let year = BS_MIN_YEAR; year <= 2090; year++) {
        let ok = true;
        for (let m = 1; m <= 12 && ok; m++) {
          const dim = bsDaysInMonth(year, m)!;
          for (const d of [1, dim]) {
            const iso = convertBStoAD({ year, month: m, day: d })!;
            const a = new NepaliDate(new Date(iso + "T00:00:00Z"));
            const b = new DateConverter(iso).toBs();
            const c = bikram.toBik(new Date(iso + "T00:00:00Z"));
            const want = ymdStr(year, m, d);
            if (ymdStr(a.getYear(), a.getMonth() + 1, a.getDate()) !== want || ymdStr(b.year, b.month, b.date) !== want || ymdStr(c.year, c.month, c.day) !== want) ok = false;
          }
        }
        if (!ok) break;
        horizon = year;
      }
      return horizon;
    })();
    // If this fails after a library upgrade, the sources now agree further (or
    // less far) than we claim — review the change, then update
    // VERIFIED_THROUGH_BS_YEAR in bs-data.ts to the value shown.
    expect(agreeThrough).toBe(VERIFIED_THROUGH_BS_YEAR);
  });
});

describe("formatting", () => {
  it("formats both calendars", () => {
    expect(formatDate("2026-09-20", "AD")).toBe("20-09-2026");
    expect(formatDate("2026-09-20", "BS")).toBe("04-06-2083");
    expect(formatDate("2026-09-20", "AD", "long")).toBe("20 September 2026");
    expect(formatDate("2026-09-20", "BS", "long")).toBe("04 Ashwin 2083");
    expect(formatDate("2026-09-20", "AD", "short")).toBe("20 Sep 2026");
    expect(formatDate("", "BS")).toBe("");
  });

  it("falls back to AD (never hides the date) outside the BS range", () => {
    expect(formatDate("2050-01-01", "BS")).toBe("01-01-2050 AD");
  });

  it("changing AD -> BS -> AD returns the original date", () => {
    const iso = "2026-09-20";
    const bs = formatDate(iso, "BS");
    const back = parseDate(bs, "BS");
    expect(back.ok && back.iso).toBe(iso);
  });
});

describe("parsing", () => {
  const ok = (input: string, cal: "AD" | "BS") => {
    const r = parseDate(input, cal);
    return r.ok ? r.iso : `ERR:${r.error}`;
  };

  it("accepts the common AD layouts", () => {
    for (const s of ["2026-09-20", "20/09/2026", "20-09-2026", "2026/09/20", "20.09.2026", "20 September 2026", "20 Sep 2026", "September 20, 2026", "2026-09-20T10:30:00Z"]) {
      expect(ok(s, "AD"), s).toBe("2026-09-20");
    }
  });

  it("accepts the common BS layouts, Nepali digits and month names", () => {
    for (const s of ["2083-06-04", "04/06/2083", "04-06-2083", "2083/06/04", "4-6-2083", "04 Ashwin 2083", "4 Asoj 2083", "०४-०६-२०८३", "२०८३/०६/०४", "४ असोज २०८३"]) {
      expect(ok(s, "BS"), s).toBe("2026-09-20");
    }
  });

  it("rejects invalid dates for the calendar chosen", () => {
    expect(ok("31-02-2026", "AD")).toMatch(/^ERR/);
    expect(ok("32-06-2083", "BS")).toMatch(/^ERR/);
    expect(ok("04-13-2083", "BS")).toMatch(/^ERR/);
    expect(ok("20-09-26", "AD")).toMatch(/^ERR/);
    expect(ok("", "AD")).toMatch(/^ERR/);
  });

  it("flags day/month-ambiguous numeric dates and supports month-first", () => {
    const a = parseDate("04/06/2026", "AD");
    expect(a.ok && a.dayMonthAmbiguous).toBe(true);
    expect(a.ok && a.iso).toBe("2026-06-04");
    const b = parseDate("04/06/2026", "AD", { dayFirst: false });
    expect(b.ok && b.iso).toBe("2026-04-06");
    const c = parseDate("20/09/2026", "AD");
    expect(c.ok && c.dayMonthAmbiguous).toBe(false);
  });

  it("flags BS dates past the verified data horizon", () => {
    const r = parseDate("01-01-2086", "BS");
    expect(r.ok && r.projected).toBe(true);
    const s = parseDate("01-01-2083", "BS");
    expect(s.ok && s.projected).toBe(false);
    expect(isProjectedBs("2030-01-01")).toBe(true);
    expect(isProjectedBs("2026-09-20")).toBe(false);
  });
});

describe("calendar detection", () => {
  const today = "2026-09-20";

  it("detects a BS column", () => {
    const d = detectCalendar(["04-06-2083", "05-06-2083", "2083-06-10"], { today });
    expect(d.calendar).toBe("BS");
    expect(d.counts.BS).toBe(3);
    expect(convertAll(["04-06-2083"], "BS")[0].iso).toBe("2026-09-20");
  });

  it("detects an AD column", () => {
    const d = detectCalendar(["2026-09-20", "20/09/2026", "21-09-2026"], { today });
    expect(d.calendar).toBe("AD");
  });

  it("flags mixed columns and identifies the odd rows", () => {
    const d = detectCalendar(["2083-06-04", "2083-06-05", "2026-09-22"], { today });
    expect(d.calendar).toBe("mixed");
    expect(d.needsReview).toBe(true);
    expect(d.rows.map((r) => r.calendar)).toEqual(["BS", "BS", "AD"]);
  });

  it("does not guess when a date fits both calendars equally", () => {
    const d = detectCalendar(["2045-05-05"], { today });
    expect(d.calendar).toBe("ambiguous");
    expect(d.needsReview).toBe(true);
  });

  it("uses the header only as a tie-breaker", () => {
    expect(detectCalendar(["2045-05-05"], { today, header: "Nepali Date" }).calendar).toBe("BS");
    expect(detectCalendar(["2045-05-05"], { today, header: "AD Date" }).calendar).toBe("AD");
    // a clear year beats a misleading header
    expect(detectCalendar(["2083-06-04"], { today, header: "AD Date" }).calendar).toBe("BS");
  });

  it("flags invalid rows and day/month ambiguity for review", () => {
    expect(detectCalendar(["2026-09-20", "not a date"], { today }).needsReview).toBe(true);
    expect(detectCalendar(["04/06/2026"], { today }).needsReview).toBe(true);
    expect(detectCalendar([], { today }).calendar).toBe("none");
  });
});

describe("ranges and periods", () => {
  it("BS month ranges use BS month boundaries", () => {
    expect(monthRange("BS", "2026-09-20")).toEqual({ from: "2026-09-17", to: "2026-10-17" });
    expect(monthRange("BS", "2026-08-20")).toEqual({ from: "2026-08-17", to: "2026-09-16" });
    expect(monthRange("AD", "2026-09-20")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("month arithmetic works in BS", () => {
    expect(addMonths("BS", "2026-09-20", -1)).toBe("2026-08-17");
    expect(addMonths("BS", "2026-09-20", 1)).toBe(convertBStoAD({ year: 2083, month: 7, day: 1 }));
    expect(addMonths("BS", "2026-04-20", -3)).toBe(convertBStoAD({ year: 2082, month: 10, day: 1 }));
  });

  it("presets follow the organization's calendar", () => {
    expect(presetRange("this_month", "BS", "2026-09-20")).toEqual({ from: "2026-09-17", to: "2026-09-20" });
    expect(presetRange("last_month", "BS", "2026-09-20")).toEqual({ from: "2026-08-17", to: "2026-09-16" });
    expect(presetRange("this_month", "AD", "2026-09-20")).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    const fy = presetRange("this_fiscal_year", "BS", "2026-09-20");
    expect(fy.from).toBe(convertBStoAD({ year: 2083, month: 4, day: 1 }));
  });

  it("Nepal fiscal year runs Shrawan 1 to Ashadh end", () => {
    const fy = bsFiscalYearRange(2083)!;
    expect(fy.label).toBe("2083/84");
    expect(convertADtoBS(fy.from)).toEqual({ year: 2083, month: 4, day: 1 });
    expect(convertADtoBS(fy.to)).toEqual({ year: 2084, month: 3, day: bsDaysInMonth(2084, 3) });
    expect(bsFiscalYearOf("2026-09-20")!.label).toBe("2083/84");
    expect(bsFiscalYearOf("2026-07-01")!.label).toBe("2082/83");
  });

  it("builds month grids for the picker", () => {
    const grid = monthCells("BS", 2083, 6)!;
    expect(grid.monthName).toBe("Ashwin");
    expect(grid.days).toHaveLength(bsDaysInMonth(2083, 6)!);
    expect(grid.days[3].iso).toBe("2026-09-20");
  });
});

describe("business 'today' uses Nepal time", () => {
  it("rolls to the next day at 18:15 UTC (00:00 NPT)", () => {
    expect(todayIso(new Date("2026-09-19T18:14:00Z"))).toBe("2026-09-19");
    expect(todayIso(new Date("2026-09-19T18:15:00Z"))).toBe("2026-09-20");
    expect(todayIso(new Date("2026-09-19T20:00:00Z"))).toBe("2026-09-20");
  });
});

describe("BS month periods, filing dates and defaults", () => {
  it("monthChoices lists real, contiguous BS month boundaries", async () => {
    const { monthChoices, monthLabel, filingDueDate } = await import("./index");
    const list = monthChoices("BS", "2026-09-20", 3, 1);
    expect(list).toHaveLength(5);
    // newest first, each month starts the day after the previous one ends
    for (let i = 0; i < list.length - 1; i++) {
      const next = new Date(list[i + 1].to + "T00:00:00Z").getTime() + 86_400_000;
      expect(new Date(list[i].from + "T00:00:00Z").getTime()).toBe(next);
    }
    expect(list[1].label).toBe(monthLabel("BS", "2026-09-20"));
    // every boundary is a BS day 1 / last day
    for (const m of list) {
      expect(convertADtoBS(m.from)!.day).toBe(1);
      expect(convertADtoBS(m.to)!.day).toBe(bsDaysInMonth(convertADtoBS(m.to)!.year, convertADtoBS(m.to)!.month));
    }
    expect(filingDueDate("BS", list[1].from)).toBeTruthy();
  });

  it("filing due date is the 25th of the NEXT month in the organization's calendar", async () => {
    const { filingDueDate } = await import("./index");
    const bsDue = convertADtoBS(filingDueDate("BS", "2026-09-20"))!;
    const anchor = convertADtoBS("2026-09-20")!;
    expect(bsDue.day).toBe(25);
    expect(bsDue.month).toBe(anchor.month === 12 ? 1 : anchor.month + 1);
    expect(filingDueDate("AD", "2026-09-05")).toBe("2026-10-25");
    expect(filingDueDate("AD", "2026-12-05")).toBe("2027-01-25");
  });

  it("compliance defaults follow BS months for BS organizations", async () => {
    const { generateNepaliDefaultItems } = await import("../compliance/nepal-calendar");
    const bs = generateNepaliDefaultItems(2, "BS", "2026-09-20");
    const ad = generateNepaliDefaultItems(2, "AD", "2026-09-20");
    expect(bs.map((i) => i.period)).toEqual(["Ashwin 2083", "Ashwin 2083", "Kartik 2083", "Kartik 2083"]);
    expect(ad[0].period).toBe("September 2026");
    expect(convertADtoBS(bs[0].dueDate)).toMatchObject({ month: 7, day: 25 });
  });
});
