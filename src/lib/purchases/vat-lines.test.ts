import { describe, expect, it } from "vitest";
import { lineVatRate, splitByTreatment } from "./vat-lines";

describe("VAT on the lines of a purchase invoice", () => {
  it("taxes only taxable lines of a VAT bill", () => {
    expect(lineVatRate("vat", "taxable", 13)).toBe(13);
    expect(lineVatRate("vat", undefined, 13)).toBe(13);
    expect(lineVatRate("vat", "zero_rated", 13)).toBe(0);
    expect(lineVatRate("vat", "exempt", 13)).toBe(0);
    expect(lineVatRate("pan", "taxable", 13)).toBe(0);
    expect(lineVatRate("no_bill", undefined, 13)).toBe(0);
  });

  it("splits a mixed bill's value by treatment", () => {
    const lines = [{ taxable: 1000, taxTreatment: "taxable" as const }, { taxable: 400, taxTreatment: "zero_rated" as const }, { taxable: 250.5, taxTreatment: "exempt" as const }, { taxable: 100 }];
    expect(splitByTreatment("vat", lines)).toEqual({ taxable: 1100, zeroRated: 400, exempt: 250.5 });
    // A bill that is not a VAT bill has no treatments: it is all plain value.
    expect(splitByTreatment("pan", lines)).toEqual({ taxable: 1750.5, zeroRated: 0, exempt: 0 });
  });
});

import { parseTreatmentCell } from "./vat-lines";

describe("reading a VAT treatment cell", () => {
  it("understands the usual words and leaves blank as taxable", () => {
    expect(parseTreatmentCell("")).toBeUndefined();
    expect(parseTreatmentCell("Taxable")).toBe("taxable");
    expect(parseTreatmentCell("Zero-rated")).toBe("zero_rated");
    expect(parseTreatmentCell("zero rated")).toBe("zero_rated");
    expect(parseTreatmentCell("EXEMPT")).toBe("exempt");
    expect(parseTreatmentCell("sometimes")).toBeNull();
  });
});
