import { describe, it, expect } from "vitest";
import { openingSide, signedOpeningBalance } from "./opening-sign";

describe("party opening balance sign", () => {
  it("a supplier's Cr is stored positive (we owe them) and Dr negative", () => {
    expect(signedOpeningBalance("supplier", 45000, "CR")).toBe(45000);
    expect(signedOpeningBalance("supplier", 45000, "DR")).toBe(-45000);
  });

  it("a customer's Dr is stored positive (they owe us) and Cr negative", () => {
    expect(signedOpeningBalance("customer", 1000, "DR")).toBe(1000);
    expect(signedOpeningBalance("customer", 1000, "CR")).toBe(-1000);
  });

  it("what you pick is what you get back", () => {
    for (const party of ["customer", "supplier"] as const) {
      for (const side of ["DR", "CR"] as const) {
        expect(openingSide(party, signedOpeningBalance(party, 250, side))).toBe(side);
      }
    }
  });

  it("ignores the sign of the typed amount and blank input", () => {
    expect(signedOpeningBalance("supplier", -300, "CR")).toBe(300);
    expect(signedOpeningBalance("supplier", NaN, "CR")).toBe(0);
  });
});
