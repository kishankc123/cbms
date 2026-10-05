import { describe, expect, it } from "vitest";
import { checkDisposal, disposalAmounts } from "./disposal-math";

describe("disposal amounts", () => {
  it("a sale above book value is a gain, with VAT on top of the price", () => {
    expect(disposalAmounts({ cost: 100000, accumulated: 60000, proceeds: 50000, vatRate: 13 })).toEqual({ netBookValue: 40000, vat: 6500, total: 56500, gainLoss: 10000 });
  });
  it("a sale below book value is a loss", () => {
    expect(disposalAmounts({ cost: 100000, accumulated: 60000, proceeds: 25000, vatRate: 0 })).toEqual({ netBookValue: 40000, vat: 0, total: 25000, gainLoss: -15000 });
  });
  it("a write-off loses the whole net book value", () => {
    expect(disposalAmounts({ cost: 100000, accumulated: 60000, proceeds: 0, vatRate: 0 }).gainLoss).toBe(-40000);
  });
});

describe("disposal checks", () => {
  it("a sale needs a price and where the money went", () => {
    expect(checkDisposal({ kind: "sale", proceeds: 0, reason: "", receivedAccountId: "a" })).toMatch(/sale price/);
    expect(checkDisposal({ kind: "sale", proceeds: 100, reason: "", receivedAccountId: null })).toMatch(/cash or bank/);
    expect(checkDisposal({ kind: "sale", proceeds: 100, reason: "", receivedAccountId: "a" })).toBeNull();
  });
  it("a disposal or write-off needs a reason", () => {
    expect(checkDisposal({ kind: "disposal", proceeds: 0, reason: " ", receivedAccountId: null })).toMatch(/reason for the disposal/);
    expect(checkDisposal({ kind: "write_off", proceeds: 0, reason: "", receivedAccountId: null })).toMatch(/write-off/);
    expect(checkDisposal({ kind: "write_off", proceeds: 0, reason: "Fire", receivedAccountId: null })).toBeNull();
  });
});
