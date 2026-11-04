import { describe, expect, it } from "vitest";
import { buildSuggestion, likePrefix, normalizeDescription, type PastExpense } from "./suggestion-rules";

const row = (description: string, categoryAccountId: string, expenseDate: string, subtotal: number, n = 1): PastExpense => ({ description, categoryAccountId, expenseDate, subtotal, expenseNumber: `EXP-000${n}` });

describe("expense suggestions", () => {
  it("compares descriptions without case or extra spaces", () => {
    expect(normalizeDescription("  Apple   Juice ")).toBe("apple juice");
  });

  it("makes the typed text safe to match the start of a description", () => {
    expect(likePrefix("100% pure_x")).toBe("100" + "\\" + "% pure" + "\\" + "_x%");
  });

  it("gives nothing when there is nothing earlier or nothing typed", () => {
    expect(buildSuggestion("apple", [])).toBeNull();
    expect(buildSuggestion("  ", [row("Apple", "c1", "2083-04-01", 100)])).toBeNull();
  });

  it("remembers the last category, date and amount", () => {
    const s = buildSuggestion("apple", [row("Apple", "fruit", "2083-06-31", 1500, 3), row("apple ", "fruit", "2083-05-10", 1200, 2)])!;
    expect(s.times).toBe(2);
    expect(s.last).toEqual({ categoryAccountId: "fruit", date: "2083-06-31", amount: 1500, number: "EXP-0003" });
    expect(s.range).toBeNull();
    expect(s.others).toEqual([]);
  });

  it("shows the usual range only from three earlier expenses", () => {
    const s = buildSuggestion("apple", [row("Apple", "fruit", "2083-06-31", 1500), row("Apple", "fruit", "2083-05-10", 1200), row("Apple", "fruit", "2083-04-02", 1800)])!;
    expect(s.range).toEqual({ min: 1200, max: 1800 });
  });

  it("offers the other categories it has gone to, most used first", () => {
    const s = buildSuggestion("apple", [row("Apple", "fruit", "2083-06-01", 1), row("Apple", "gift", "2083-05-01", 1), row("Apple", "gift", "2083-04-01", 1), row("Apple", "staff", "2083-03-01", 1)])!;
    expect(s.last.categoryAccountId).toBe("fruit");
    expect(s.others).toEqual([{ categoryAccountId: "gift", count: 2 }, { categoryAccountId: "staff", count: 1 }]);
  });

  it("prefers an exact match over a longer description used more recently", () => {
    const s = buildSuggestion("apple", [row("Apple juice", "drinks", "2083-06-01", 300), row("Apple", "fruit", "2083-03-01", 900)])!;
    expect(s.description).toBe("Apple");
    expect(s.last.categoryAccountId).toBe("fruit");
  });

  it("falls back to the most recently used description when nothing matches exactly", () => {
    const s = buildSuggestion("app", [row("Apple juice", "drinks", "2083-06-01", 300), row("Apple", "fruit", "2083-03-01", 900)])!;
    expect(s.description).toBe("Apple juice");
  });
});
