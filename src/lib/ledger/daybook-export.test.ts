import { describe, expect, it } from "vitest";
import { buildDaybook, type DayEntry, type DayLine } from "./daybook-rules";
import { accountColumns, daybookSheets, exportFileName, formatMoney, imageModel, sheetCsv, type DayExtras } from "./daybook-export";
import { chequeChip } from "./daybook-cheques";

const l = (accountId: string, debit: number, credit: number, modeName: string | null = null): DayLine => ({ accountId, debit, credit, modeName });
const entries: DayEntry[] = [
  { id: "s", sourceType: "sale", sourceId: "i1", isReversed: false, reversalOfId: null, lines: [l("ar", 1000, 0), l("rev", 0, 1000)] },
  { id: "r", sourceType: "receipt", sourceId: "i1", isReversed: false, reversalOfId: null, lines: [l("cash", 600, 0, "Cash"), l("ar", 0, 600)] },
  { id: "x", sourceType: "expense", sourceId: "e1", isReversed: false, reversalOfId: null, lines: [l("rent", 150, 0), l("cash", 0, 150, "Cash")] },
];
const d = buildDaybook({ day: "2026-11-08", entries, cashAccounts: [{ id: "cash", code: "1000", name: "Cash" }], opening: { cash: 5000 }, closing: { cash: 5450 } });
const ctx = { company: "DS Finance, group", dateLabel: "24 Kartik 2083", otherDateLabel: "8 Nov 2026", currency: "NPR" };

const extras: DayExtras = {
  monthLabel: "1 Kartik 2083",
  month: { from: "2026-10-18", sales: 9000, purchases: 2000, expenses: 700, moneyIn: 8000, moneyOut: 3000 },
  flows: [{ key: "recovered", label: "Customer credit recovered", today: 400, month: 1400 }, { key: "suppliers", label: "Supplier payments", today: 0, month: 500 }],
  credit: { given: 400, taken: 0 },
  cashCount: { counted: 5400, books: 5450 },
  cheques: { any: false, groups: [] },
};

describe("the shareable image", () => {
  const m = imageModel(d, extras);
  it("has a card each for sales, purchases and expenses, with the share of each way of paying and the month so far", () => {
    expect(m.cards.map((c) => [c.title, c.total, c.month])).toEqual([["Sales", "1,000.00", "9,000.00"], ["Purchases", "0.00", "2,000.00"], ["Expenses", "150.00", "700.00"]]);
    expect(m.cards[0].modes.map((x) => [x.label, x.amount, x.share])).toEqual([["Cash", "600.00", 0.6], ["On credit", "400.00", 0.4]]);
    expect(m.note).toBe("Credit given today 400.00 \u00b7 month so far is from 1 Kartik 2083");
  });
  it("lists collections and payments, quiet when nothing happened today", () => {
    expect(m.flows).toEqual([
      { label: "Customer credit recovered", today: "400.00", month: "1,400.00", quiet: false, sub: false },
      { label: "Supplier payments", today: "\u2014", month: "500.00", quiet: true, sub: false },
    ]);
  });
  it("shows the cash position with a column for each account and a total that adds up", () => {
    expect(m.cash.columns).toEqual(["Cash", "Total"]);
    const row = (label: string) => m.cash.rows.find((r) => r.label === label)!.values;
    expect(row("Opening")).toEqual(["5,000.00", "5,000.00"]);
    expect(row("Money in")).toEqual(["+600.00", "+600.00"]);
    expect(row("Money out")).toEqual(["-150.00", "-150.00"]);
    expect(row("Closing")).toEqual(["5,450.00", "5,450.00"]);
    expect(m.cash.rows.some((r) => r.label === "Moved")).toBe(false);
    expect(m.monthCash).toBe("This month: money in 8,000.00 \u00b7 money out 3,000.00");
  });
  it("adds a chip for the cash count only when one was saved", () => {
    expect(m.chips).toEqual(["Cash count: counted 5,400.00 \u00b7 books 5,450.00 \u00b7 short 50.00"]);
    expect(imageModel(d, { ...extras, cashCount: null }).chips).toEqual([]);
  });
  it("keeps the picture to a few account columns by joining the rest", () => {
    const many = { ...d, accounts: Array.from({ length: 8 }, (_, i) => ({ accountId: "a" + i, code: "101" + i, name: "Bank " + i, group: "bank" as const, opening: 10, in: 1, out: 2, transfers: 0, closing: 9 })) };
    const cols = accountColumns(many);
    expect(cols).toHaveLength(5);
    expect(cols[4]).toMatchObject({ name: "Other accounts", opening: 40, closing: 36 });
  });
  it("describes the cheques in one line", () => {
    const g = (key: "due" | "overdue" | "cleared", n: number, issued = 0, received = 0) => ({ key, label: key, rows: Array.from({ length: n }, () => ({}) as never), issued, received });
    expect(chequeChip({ any: true, groups: [g("due", 2, 25000, 40000), g("overdue", 1)] }, (n) => String(n))).toBe("Dated today: we give 25000, we get 40000 \u00b7 1 late");
    expect(chequeChip({ any: false, groups: [] }, String)).toBeNull();
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
  it("adds the month and the collections to the summary when they are given", () => {
    const rows = daybookSheets(d, ctx, [], undefined, extras)[0].rows;
    expect(rows.find((r) => r[0] === "Total sales")).toEqual(["Total sales", 1000, 9000]);
    expect(rows.find((r) => r[0] === "Customer credit recovered")).toEqual(["Customer credit recovered", 400, 1400]);
    expect(rows.find((r) => r[0] === "Counted minus books")).toEqual(["Counted minus books", -50]);
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
