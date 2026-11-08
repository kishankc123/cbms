import { describe, expect, it } from "vitest";
import { buildDaybook, type DayEntry, type DayLine } from "./daybook-rules";
import { daybookSheets, exportFileName, formatMoney, imageRows, sheetCsv } from "./daybook-export";

const l = (accountId: string, debit: number, credit: number, modeName: string | null = null): DayLine => ({ accountId, debit, credit, modeName });
const entries: DayEntry[] = [
  { id: "s", sourceType: "sale", sourceId: "i1", isReversed: false, reversalOfId: null, lines: [l("ar", 1000, 0), l("rev", 0, 1000)] },
  { id: "r", sourceType: "receipt", sourceId: "i1", isReversed: false, reversalOfId: null, lines: [l("cash", 600, 0, "Cash"), l("ar", 0, 600)] },
  { id: "x", sourceType: "expense", sourceId: "e1", isReversed: false, reversalOfId: null, lines: [l("rent", 150, 0), l("cash", 0, 150, "Cash")] },
];
const d = buildDaybook({ day: "2026-11-08", entries, cashAccounts: [{ id: "cash", code: "1000", name: "Cash" }], opening: { cash: 5000 }, closing: { cash: 5450 } });
const ctx = { company: "DS Finance, group", dateLabel: "24 Kartik 2083", otherDateLabel: "8 Nov 2026", currency: "NPR" };

describe("the shareable image", () => {
  it("lays out each section with its modes, then money in and out, then cash and bank with opening and closing", () => {
    const rows = imageRows(d);
    const text = rows.filter((r) => r.left).map((r) => `${r.kind}|${r.left}|${r.right ?? ""}`);
    expect(text.slice(0, 5)).toEqual(["section|Sales|1,000.00", "sub|Cash|600.00", "sub|On credit|400.00", "section|Purchases|0.00", "section|Expenses|150.00"]);
    expect(text).toContain("line|Money in|600.00");
    expect(text).toContain("line|Money out|150.00");
    expect(text).toContain("line|Net|450.00");
    expect(text).toContain("line|Cash|5,450.00");
    expect(text).toContain("sub|Opening 5,000.00|In 600.00  Out 150.00");
    expect(text).toContain("line|Total|5,450.00");
  });
  it("uses Indian digit grouping", () => {
    expect(formatMoney(1234567.5)).toBe("12,34,567.50");
  });
});

describe("the spreadsheet", () => {
  const sheets = daybookSheets(d, ctx);
  it("has a summary sheet and a cash and bank sheet that reconcile", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Daybook", "Cash and bank"]);
    const cash = sheets[1].rows;
    expect(cash.find((r) => r[0] === "Total")).toEqual(["Total", 5000, 600, 150, 0, 5450]);
    expect(sheets[0].rows.find((r) => r[0] === "Total sales")).toEqual(["Total sales", 1000]);
  });
  it("makes comma-separated text that survives commas and quotes", () => {
    const csv = sheetCsv(sheets[0].rows);
    expect(csv.split("\n")[0]).toBe('"DS Finance, group"');
    expect(csv).toContain("Total sales,1000.00");
    expect(sheetCsv([['say "hi"', 2]])).toBe('"say ""hi""",2.00');
  });
  it("names the file by company and day", () => {
    expect(exportFileName("DS Finance, group!", "2026-11-08", "png")).toBe("Daybook-DS-Finance-group-2026-11-08.png");
    expect(exportFileName("!!!", "2026-11-08", "xlsx")).toBe("Daybook-Business-2026-11-08.xlsx");
  });
});
