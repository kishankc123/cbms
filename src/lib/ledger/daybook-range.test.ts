import { describe, expect, it } from "vitest";
import { buildRange, clampRange, datesBetween, MAX_RANGE_DAYS, type RangeEntry } from "./daybook-range";

const accts = [{ id: "cash", code: "1000", name: "Cash" }];
const line = (accountId: string, debit: number, credit: number, modeName: string | null = null) => ({ accountId, debit, credit, modeName });
const e = (id: string, date: string, sourceType: string, sourceId: string | null, lines: RangeEntry["lines"], extra: Partial<RangeEntry> = {}): RangeEntry => ({ id, date, sourceType, sourceId, isReversed: false, reversalOfId: null, lines, ...extra });

describe("a range of days", () => {
  const entries = [
    e("a", "2026-11-01", "sale", "i1", [line("ar", 1000, 0)]),
    e("b", "2026-11-01", "receipt", "i1", [line("cash", 400, 0, "Cash")]),
    e("c", "2026-11-03", "expense", "x1", [line("rent", 150, 0), line("cash", 0, 150, "Cash")]),
  ];
  const r = buildRange({ from: "2026-11-01", to: "2026-11-04", entries, cashAccounts: accts, openingBefore: { cash: 1000 } });

  it("has a row for every day, with quiet days carrying the balance through", () => {
    expect(r.days.map((d) => [d.day, d.closing, d.quiet])).toEqual([["2026-11-01", 1400, false], ["2026-11-02", 1400, true], ["2026-11-03", 1250, false], ["2026-11-04", 1250, true]]);
  });

  it("adds the period up like a single day, and the last close is the balance", () => {
    expect(r.total.sales.total).toBe(1000);
    expect(r.total.expenses.total).toBe(150);
    expect(r.total).toMatchObject({ moneyIn: 400, moneyOut: 150 });
    expect(r.total.totals).toMatchObject({ opening: 1000, closing: 1250 });
    expect(r.days.reduce((s, d) => s + d.sales, 0)).toBe(r.total.sales.total);
    expect(r.busiest).toEqual({ day: "2026-11-01", sales: 1000 });
  });

  it("cancels an invoice and its undo made on different days inside the range", () => {
    const fixed = [{ ...entries[0], isReversed: true }, ...entries.slice(1), e("u", "2026-11-04", "sale", "i1", [line("ar", 0, 1000)], { reversalOfId: "a" })];
    const t = buildRange({ from: "2026-11-01", to: "2026-11-04", entries: fixed, cashAccounts: accts, openingBefore: { cash: 1000 } }).total;
    expect(t.sales.total).toBe(0);
    expect(t.reconciles).toBe(true);
  });

  it("keeps ranges to a sensible length", () => {
    expect(datesBetween("2026-11-01", "2026-11-03")).toHaveLength(3);
    expect(clampRange("2026-11-05", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-01", trimmed: false });
    const big = clampRange("2025-01-01", "2026-11-08");
    expect(big.trimmed).toBe(true);
    expect(datesBetween(big.from, big.to)).toHaveLength(MAX_RANGE_DAYS);
  });
});
