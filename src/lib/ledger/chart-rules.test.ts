import { describe, it, expect } from "vitest";
import { descendantIds, isSystemAccount, nextChildCode, rollUpBalances, validateTopLevelCode } from "./chart-rules";

describe("chart of accounts rules", () => {
  it("allocates the next code from the HIGHEST sequence, not the count", () => {
    expect(nextChildCode([], "1010")).toBe("1010.01");
    expect(nextChildCode(["1010.01", "1010.02", "1010.03"], "1010")).toBe("1010.04");
    // .02 was deleted: counting siblings (2) would reuse .03
    expect(nextChildCode(["1010.01", "1010.03"], "1010")).toBe("1010.04");
    // other groups and deeper levels don't interfere
    expect(nextChildCode(["1010.01", "1100.07", "1010.01.05"], "1010")).toBe("1010.02");
    expect(nextChildCode(["1010.09"], "1010")).toBe("1010.10");
  });

  it("treats the dot in a parent code literally", () => {
    expect(nextChildCode(["1010x01", "1010.01"], "1010")).toBe("1010.02");
  });

  it("validates top-level codes", () => {
    expect(validateTopLevelCode("6000")).toBeNull();
    expect(validateTopLevelCode("A-100")).toBeNull();
    expect(validateTopLevelCode("")).toMatch(/required/);
    expect(validateTopLevelCode("1010.05")).toMatch(/dot/);
    expect(validateTopLevelCode("10 10")).toMatch(/letters/);
    expect(validateTopLevelCode("x".repeat(21))).toMatch(/20/);
  });

  it("recognises system accounts by code (top level only) or by role", () => {
    const none = new Set<string>();
    expect(isSystemAccount({ id: "a", code: "2100", parentAccountId: null }, none)).toBe(true);
    expect(isSystemAccount({ id: "b", code: "2100", parentAccountId: "p" }, none)).toBe(false);
    expect(isSystemAccount({ id: "c", code: "7000", parentAccountId: null }, none)).toBe(false);
    expect(isSystemAccount({ id: "d", code: "1010.02", parentAccountId: "p" }, new Set(["d"]))).toBe(true);
  });

  const tree = [
    { id: "g", parentAccountId: null },
    { id: "s1", parentAccountId: "g" },
    { id: "s2", parentAccountId: "g" },
    { id: "s1a", parentAccountId: "s1" },
    { id: "other", parentAccountId: null },
  ];

  it("finds every descendant", () => {
    expect(descendantIds(tree, "g").sort()).toEqual(["s1", "s1a", "s2"]);
    expect(descendantIds(tree, "s1")).toEqual(["s1a"]);
    expect(descendantIds(tree, "other")).toEqual([]);
  });

  it("rolls balances up the hierarchy", () => {
    const r = rollUpBalances([
      { ...tree[0], own: 100 },
      { ...tree[1], own: 50 },
      { ...tree[2], own: 25.25 },
      { ...tree[3], own: 10 },
      { ...tree[4], own: 7 },
    ]);
    expect(r.get("s1")).toEqual({ own: 50, total: 60 });
    expect(r.get("g")).toEqual({ own: 100, total: 185.25 });
    expect(r.get("other")).toEqual({ own: 7, total: 7 });
  });

  it("survives a corrupt parent cycle", () => {
    const r = rollUpBalances([
      { id: "a", parentAccountId: "b", own: 1 },
      { id: "b", parentAccountId: "a", own: 2 },
    ]);
    expect(r.get("a")!.total).toBeGreaterThan(0);
  });
});
