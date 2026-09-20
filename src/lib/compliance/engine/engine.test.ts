import { describe, it, expect } from "vitest";
import { convertADtoBS } from "@/lib/calendar";
import { assertValidCondition, isApplicable } from "./applicability";
import { assertValidDueRule, computeDueDate, periodsFor } from "./due-rules";
import { effectiveStatus, mapLegacyStatus, summarize } from "./status";
import { parsePeriodLabel } from "./period-label";
import { validateCountryConfig } from "../config/validate";
import { NEPAL } from "../config/nepal";
import type { CountryConfig } from "../config/types";

const TODAY = "2026-09-20"; // 04 Ashwin 2083

describe("applicability engine", () => {
  const vat = { fact: "registered_tax_types", op: "includes", value: "vat" } as const;

  it("shows a requirement only when its condition holds", () => {
    expect(isApplicable(vat, { registered_tax_types: ["pan", "vat"] })).toBe(true);
    expect(isApplicable(vat, { registered_tax_types: ["pan"] })).toBe(false);
  });

  it("treats no condition as always applicable and an unknown fact as not matching", () => {
    expect(isApplicable(null, {})).toBe(true);
    expect(isApplicable(vat, {})).toBe(false);
  });

  it("combines with all / any / not", () => {
    const facts = { entity_type: "private_limited", has_employees: false };
    expect(isApplicable({ all: [{ fact: "entity_type", op: "in", value: ["private_limited", "public_limited"] }, { not: { fact: "has_employees", op: "eq", value: true } }] }, facts)).toBe(true);
    expect(isApplicable({ any: [{ fact: "has_employees", op: "eq", value: true }, { fact: "entity_type", op: "eq", value: "proprietorship" }] }, facts)).toBe(false);
  });

  it("rejects malformed conditions instead of guessing", () => {
    expect(() => assertValidCondition({ fact: "x", op: "matches", value: 1 })).toThrow(/unknown operator/);
    expect(() => assertValidCondition({ all: [] })).toThrow();
    expect(() => assertValidCondition({ fact: "x", op: "in", value: 3 })).toThrow(/list/);
  });

  it("gives the same requirement to different clients depending on their facts", () => {
    const vatRegistered = { entity_type: "private_limited", registered_tax_types: ["vat"] };
    const proprietor = { entity_type: "proprietorship", registered_tax_types: [] };
    const vatReturn = NEPAL.templates.find((t) => t.key === "vat_return")!;
    expect(isApplicable(vatReturn.applicability, vatRegistered)).toBe(true);
    expect(isApplicable(vatReturn.applicability, proprietor)).toBe(false);
  });
});

describe("periods and due dates (BS-counted)", () => {
  const ctx = { calendar: "BS" as const, today: TODAY, fiscal: null };
  const vatRule = { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 } as const;

  it("counts months in the BS calendar with stable keys", () => {
    const ps = periodsFor("month", ctx, 1, 2);
    expect(ps.map((p) => p.label)).toEqual(["Bhadra 2083", "Ashwin 2083", "Kartik 2083", "Mangsir 2083"]);
    expect(ps.map((p) => p.key)).toEqual(["M:BS:2083-05", "M:BS:2083-06", "M:BS:2083-07", "M:BS:2083-08"]);
    // contiguous real boundaries
    expect(convertADtoBS(ps[1].start)).toMatchObject({ year: 2083, month: 6, day: 1 });
  });

  it("VAT for Bhadra is due on the 25th of Ashwin", () => {
    const bhadra = periodsFor("month", ctx, 1, 0)[0];
    const due = computeDueDate(vatRule, bhadra, "BS");
    expect(convertADtoBS(due)).toMatchObject({ year: 2083, month: 6, day: 25 });
  });

  it("rolls the year over: Chaitra's VAT is due in Baisakh of the next year", () => {
    const chaitra = periodsFor("month", { ...ctx, today: "2027-04-05" }, 0, 0)[0]; // Chaitra 2083
    expect(chaitra.label).toBe("Chaitra 2083");
    expect(convertADtoBS(computeDueDate(vatRule, chaitra, "BS"))).toMatchObject({ year: 2084, month: 1, day: 25 });
  });

  it("fiscal years start in Shrawan and are keyed by their real AD start", () => {
    const [prev, cur] = periodsFor("fiscal_year", ctx, 1, 0);
    expect(cur.label).toBe("FY 2083/84");
    expect(prev.label).toBe("FY 2082/83");
    expect(convertADtoBS(cur.start)).toMatchObject({ year: 2083, month: 4, day: 1 });
    expect(convertADtoBS(prev.end)).toMatchObject({ year: 2083, month: 3 });
    expect(cur.key).toBe(`FY:${cur.start}`);
    // previous ends the day before the current starts
    expect(new Date(cur.start + "T00:00:00Z").getTime() - new Date(prev.end + "T00:00:00Z").getTime()).toBe(86_400_000);
  });

  it("income-tax style rule: three months after fiscal year end, on that month's last day", () => {
    const [prev] = periodsFor("fiscal_year", ctx, 1, 0);
    const due = convertADtoBS(computeDueDate({ period: "fiscal_year", monthsAfterEnd: 3, dayOfMonth: "last" }, prev, "BS"))!;
    expect(due).toMatchObject({ year: 2083, month: 6 }); // end of Ashwin
    expect(due.day).toBeGreaterThanOrEqual(29);
  });

  it("uses the organization's configured fiscal year when it covers today", () => {
    const fiscal = { from: "2026-07-17", to: "2027-07-16" };
    const [cur] = periodsFor("fiscal_year", { ...ctx, fiscal }, 0, 0);
    expect(cur.start).toBe("2026-07-17");
    expect(cur.end).toBe("2027-07-16");
  });

  it("quarters run in 3-month blocks from the fiscal year's first month", () => {
    const [q] = periodsFor("quarter", ctx, 0, 0);
    expect(q.label).toBe("Shrawan–Ashwin 2083");
    expect(convertADtoBS(q.start)).toMatchObject({ month: 4, day: 1 });
  });

  it("counts Gregorian months when the requirement is AD-based, and supports day offsets", () => {
    const [sep] = periodsFor("month", { calendar: "AD", today: TODAY, fiscal: null }, 0, 0);
    expect(sep.label).toBe("September 2026");
    expect(computeDueDate(vatRule, sep, "AD")).toBe("2026-10-25");
    expect(computeDueDate({ period: "month", daysAfterEnd: 15 }, sep, "AD")).toBe("2026-10-15");
  });

  it("validates due rules", () => {
    expect(() => assertValidDueRule({ period: "week" })).toThrow();
    expect(() => assertValidDueRule({ period: "month", dayOfMonth: 40 })).toThrow();
    expect(() => assertValidDueRule({ period: "month", monthsAfterEnd: -1 })).toThrow();
  });
});

describe("status", () => {
  const item = (status: Parameters<typeof effectiveStatus>[0]["status"], dueDate: string) => ({ status, dueDate });

  it("derives overdue instead of storing it", () => {
    expect(effectiveStatus(item("pending", "2026-09-19"), TODAY)).toBe("overdue");
    expect(effectiveStatus(item("partially_paid", "2026-09-19"), TODAY)).toBe("overdue");
    expect(effectiveStatus(item("pending", "2026-09-20"), TODAY)).toBe("pending");
    expect(effectiveStatus(item("filed", "2026-01-01"), TODAY)).toBe("filed");
    expect(effectiveStatus(item("not_applicable", "2026-01-01"), TODAY)).toBe("not_applicable");
  });

  it("summarises for the dashboard, ignoring not-applicable items", () => {
    const s = summarize(
      [item("pending", "2026-09-01"), item("pending", "2026-09-25"), item("in_progress", "2026-10-30"), item("filed", "2026-09-01"), item("paid", "2026-08-01"), item("not_applicable", "2026-09-01")],
      TODAY
    );
    expect(s).toEqual({ overdue: 1, dueSoon: 1, upcoming: 1, completed: 2 });
  });

  it("maps old calendar statuses", () => {
    expect(mapLegacyStatus("upcoming", false)).toBe("pending");
    expect(mapLegacyStatus("overdue", false)).toBe("pending");
    expect(mapLegacyStatus("under_review", false)).toBe("in_progress");
    expect(mapLegacyStatus("submitted", false)).toBe("filed");
    expect(mapLegacyStatus("completed", true)).toBe("paid");
    expect(mapLegacyStatus("completed", false)).toBe("filed");
  });

  it("reads old period labels in either calendar", () => {
    expect(parsePeriodLabel("Ashwin 2083")).toEqual({ calendar: "BS", year: 2083, month: 6 });
    expect(parsePeriodLabel("September 2026")).toEqual({ calendar: "AD", year: 2026, month: 9 });
    expect(parsePeriodLabel("FY 2082/83")).toBeNull();
  });
});

describe("country configuration", () => {
  it("Nepal's shipped configuration is valid", () => {
    expect(() => validateCountryConfig(NEPAL)).not.toThrow();
    expect(NEPAL.country.statutoryCalendar).toBe("BS");
  });

  it("does not activate a scheduled requirement whose rule is unknown", () => {
    const t = NEPAL.templates.filter((x) => x.frequency !== "event_based" && !x.dueRule);
    expect(t.every((x) => !x.isActive)).toBe(true);
  });

  it("a new country is data only — no engine or UI change", () => {
    const uk: CountryConfig = {
      country: { code: "GB", name: "United Kingdom", currency: "GBP", statutoryCalendar: "AD" },
      entityTypes: [{ key: "ltd", name: "Private limited company" }],
      authorities: [{ key: "hmrc", name: "HMRC" }],
      taxTypes: [{ key: "vat", name: "VAT", authorityKey: "hmrc" }],
      templates: [
        {
          key: "vat_return",
          name: "VAT Return",
          categoryKey: "tax",
          taxTypeKey: "vat",
          frequency: "quarterly",
          applicability: { fact: "registered_tax_types", op: "includes", value: "vat" },
          dueRule: { period: "quarter", monthsAfterEnd: 1, dayOfMonth: "last" },
          isActive: true,
          isVerified: false,
        },
      ],
    };
    expect(() => validateCountryConfig(uk)).not.toThrow();
  });

  it("rejects templates that point at things that do not exist", () => {
    const bad: CountryConfig = { ...NEPAL, templates: [{ ...NEPAL.templates[0], taxTypeKey: "nope" }] };
    expect(() => validateCountryConfig(bad)).toThrow(/unknown tax type/);
    const noRule: CountryConfig = { ...NEPAL, templates: [{ ...NEPAL.templates[0], dueRule: null }] };
    expect(() => validateCountryConfig(noRule)).toThrow(/needs a due rule/);
  });
});

describe("event-based requirements", () => {
  it("an event rule is due a fixed number of days after the event", async () => {
    const { eventPeriod } = await import("./events");
    const p = eventPeriod("change-1", "Shares issued to Asha", "2026-09-20");
    expect(p).toMatchObject({ key: "E:change-1", start: "2026-09-20", end: "2026-09-20" });
    expect(computeDueDate({ period: "event", daysAfterEnd: 15 }, p, "BS")).toBe("2026-10-05");
  });

  it("requires a day count and produces no scheduled periods", () => {
    expect(() => assertValidDueRule({ period: "event" })).toThrow(/daysAfterEnd/);
    expect(() => assertValidDueRule({ period: "event", daysAfterEnd: 30 })).not.toThrow();
    expect(periodsFor("event", { calendar: "BS", today: TODAY, fiscal: null }, 1, 2)).toEqual([]);
  });
});
