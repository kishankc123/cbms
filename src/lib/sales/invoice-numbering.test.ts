import { describe, expect, it } from "vitest";
import { nextFreeInvoiceNumber } from "./invoice-numbering";

const build = (n: number) => `INV/${String(n).padStart(4, "0")}/26`;

describe("nextFreeInvoiceNumber", () => {
  it("uses the starting sequence when it is free", () => {
    expect(nextFreeInvoiceNumber(new Set(), build, 5)).toEqual({ number: "INV/0005/26", sequence: 5 });
  });
  it("skips numbers that are already used", () => {
    const taken = new Set(["INV/0005/26", "INV/0006/26"]);
    expect(nextFreeInvoiceNumber(taken, build, 5)).toEqual({ number: "INV/0007/26", sequence: 7 });
  });
  it("is not fooled by a count that lags behind (deleted rows)", () => {
    const taken = new Set(["INV/0001/26", "INV/0002/26", "INV/0003/26"]);
    expect(nextFreeInvoiceNumber(taken, build, 3).number).toBe("INV/0004/26");
  });
});
