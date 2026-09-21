import { describe, expect, it } from "vitest";
import { allocateProportional } from "./allocate";

describe("allocateProportional", () => {
  it("shares a total in proportion and always adds back up to it, to the cent", () => {
    const parts = allocateProportional(100, [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 2);
    expect(allocateProportional(1130, [1000, 0])).toEqual([1130, 0]);
    const odd = allocateProportional(0.05, [1, 1, 1]);
    expect(Math.round(odd.reduce((s, p) => s + p, 0) * 100)).toBe(5);
  });
  it("splits evenly when there are no weights, and handles nothing", () => {
    expect(allocateProportional(10, [0, 0])).toEqual([5, 5]);
    expect(allocateProportional(10, [])).toEqual([]);
  });
});
