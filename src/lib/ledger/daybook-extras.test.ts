import { describe, expect, it } from "vitest";
import { buildDaybook, ON_CREDIT, type DayEntry } from "./daybook-rules";
import { buildDayList, creditOfDay, flowRows, groupedFlows, type ListEntry } from "./daybook-extras";

const accts = [{ id: "cash", code: "1000", name: "Cash" }];
const line = (accountId: string, debit: number, credit: number, modeName: string | null = null) => ({ accountId, debit, credit, modeName });
const entry = (id: string, sourceType: string, sourceId: string | null, lines: DayEntry["lines"], extra: Partial<DayEntry> = {}): DayEntry => ({ id, sourceType, sourceId, isReversed: false, reversalOfId: null, lines, ...extra });
const book = (entries: DayEntry[]) => buildDaybook({ day: "2026-11-08", entries, cashAccounts: accts, opening: {}, closing: {} });

describe("flowRows", () => {
  it("puts collections and payments in a fixed order, with zeros for what did not happen", () => {
    const rows = flowRows([{ type: "salary_payment", today: 0, month: 310000 }, { type: "customer_payment", today: 5000, month: 142000.456 }]);
    expect(rows.map((r) => [r.key, r.today, r.month])).toEqual([["recovered", 5000, 142000.46], ["suppliers", 0, 0], ["salary", 0, 310000], ["advances", 0, 0]]);
    expect(rows.map((r) => r.label)).toEqual(["Customer credit recovered", "Supplier payments", "Salary paid", "Staff advances given"]);
  });
});

describe("groupedFlows", () => {
  it("shows salary and staff advances under one Staff payments row that adds them, each still on its own line", () => {
    const rows = groupedFlows(flowRows([{ type: "salary_payment", today: 0, month: 310000 }, { type: "staff_advance", today: 2000, month: 18000 }, { type: "customer_payment", today: 5000, month: 142000 }]));
    expect(rows.map((r) => [r.label, r.today, r.month, Boolean(r.sub)])).toEqual([
      ["Customer credit recovered", 5000, 142000, false],
      ["Supplier payments", 0, 0, false],
      ["Staff payments", 2000, 328000, false],
      ["Salary paid", 0, 310000, true],
      ["Staff advances given", 2000, 18000, true],
    ]);
  });
});

describe("creditOfDay", () => {
  it("counts only what was not paid at the time", () => {
    const d = book([
      entry("s", "sale", "i1", [line("ar", 1000, 0)]),
      entry("r", "receipt", "i1", [line("cash", 400, 0, "Cash")]),
      entry("p", "purchase", "b1", [line("stock", 300, 0), line("cash", 0, 100, "Cash")]),
    ]);
    expect(creditOfDay(d)).toEqual({ given: 600, taken: 200 });
    expect(d.sales.byMode.some((m) => m.mode === ON_CREDIT)).toBe(true);
  });
});

describe("buildDayList", () => {
  const meta = (e: DayEntry, createdAt: string, reference: string | null = null, memo: string | null = null): ListEntry => ({ ...e, createdAt, reference, memo });
  const cash = new Set(["cash"]);

  it("lists entries oldest first with the amount a person would expect", () => {
    const { rows } = buildDayList(
      [
        meta(entry("r", "receipt", "p1", [line("cash", 500, 0, "Cash"), line("ar", 0, 500)]), "2026-11-08T10:00:00Z", "R-1"),
        meta(entry("s", "sale", "i1", [line("ar", 1200, 0), line("rev", 0, 1200)]), "2026-11-08T09:00:00Z", "INV-1", "Walk-in"),
      ],
      cash,
    );
    expect(rows.map((r) => [r.kind, r.amount, r.reference])).toEqual([["Sale", 1200, "INV-1"], ["Money in", 500, "R-1"]]);
  });

  it("leaves out an entry and its undo on the same day, and marks older corrections", () => {
    const a = meta(entry("a", "sale", "i1", [line("ar", 100, 0)], { isReversed: true }), "2026-11-08T09:00:00Z");
    const undo = meta(entry("u", "sale", "i1", [line("ar", 0, 100)], { reversalOfId: "a" }), "2026-11-08T09:05:00Z");
    const olderUndo = meta(entry("o", "sale", "i0", [line("ar", 0, 50)], { reversalOfId: "elsewhere" }), "2026-11-08T11:00:00Z");
    const { rows } = buildDayList([a, undo, olderUndo], cash);
    expect(rows).toHaveLength(1);
    expect(rows[0].correction).toBe(true);
  });

  it("counts a transfer once and reports what is not listed past the limit", () => {
    const t = meta(entry("t", "inter_transfer", null, [line("cash", 0, 700), line("bank", 700, 0)]), "2026-11-08T09:00:00Z");
    expect(buildDayList([t], new Set(["cash", "bank"])).rows[0].amount).toBe(700);
    const many = Array.from({ length: 5 }, (_, i) => meta(entry(`e${i}`, "manual", null, [line("cash", 1, 0)]), `2026-11-08T09:0${i}:00Z`));
    expect(buildDayList(many, cash, 3)).toMatchObject({ hidden: 2 });
  });
});
