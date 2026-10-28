import { describe, expect, it } from "vitest";
import { findCombination, type CombinationEntry } from "./combinations";

const e = (id: string, cents: number, date = "2026-09-10"): CombinationEntry => ({ id, cents, date });

describe("one bank line that is several payments", () => {
  it("finds the entries that add up to the bank amount", () => {
    const entries = [e("a", 30000), e("b", 30000), e("c", 30000), e("d", 30000), e("e", 30000), e("far", 99999, "2026-01-01")];
    // five of 300.00 make 1,500.00; but any five of these are the same set, so there is only one way
    expect(findCombination(entries, 150000, "2026-09-10")?.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("works for money out, with negative entries", () => {
    expect(findCombination([e("a", -1000), e("b", -2500), e("c", 700)], -3500, "2026-09-10")?.sort()).toEqual(["a", "b"]);
  });

  it("gives no answer when nothing adds up, or when only a single entry would do", () => {
    expect(findCombination([e("a", 1000), e("b", 2000)], 3500, "2026-09-10")).toBeNull();
    expect(findCombination([e("a", 3500), e("b", 100)], 3500, "2026-09-10")).toBeNull();
    expect(findCombination([], 3500, "2026-09-10")).toBeNull();
    expect(findCombination([e("a", 100)], 0, "2026-09-10")).toBeNull();
  });

  it("prefers the set closest in date, and gives no answer when two sets are equally close", () => {
    const near = [e("n1", 1000, "2026-09-10"), e("n2", 2000, "2026-09-10")];
    const far = [e("f1", 1000, "2026-09-01"), e("f2", 2000, "2026-09-01")];
    expect(findCombination([...far, ...near], 3000, "2026-09-10")?.sort()).toEqual(["n1", "n2"]);
    expect(findCombination([e("x1", 1000), e("x2", 2000), e("y1", 1000), e("y2", 2000)], 3000, "2026-09-10")).toBeNull();
  });

  it("never mixes entries from the other side of the account", () => {
    expect(findCombination([e("a", 1000), e("b", -500), e("c", 500)], 1000, "2026-09-10")).toBeNull();
  });
});
