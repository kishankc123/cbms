import { describe, expect, it } from "vitest";
import { checkPurchaseRow, type PurchaseRowInput } from "./checks";
import { purchaseMappingComplete, suggestPurchaseMapping } from "./fields";
import { parsePurchaseBillType } from "./values";

describe("matching a purchase file's headers", () => {
  it("finds the usual names", () => {
    expect(suggestPurchaseMapping(["Bill Date", "Vendor", "Category", "Bill No.", "Particulars", "Amount", "Paid", "Payment Mode"])).toMatchObject({
      date: "Bill Date",
      supplier: "Vendor",
      category: "Category",
      billNumber: "Bill No.",
      description: "Particulars",
      amount: "Amount",
      paid: "Paid",
      account: "Payment Mode",
    });
  });
  it("needs only a date and an amount", () => {
    expect(purchaseMappingComplete(suggestPurchaseMapping(["Date", "Amount"]))).toBe(true);
    expect(purchaseMappingComplete(suggestPurchaseMapping(["Date", "Vendor"]))).toBe(false);
  });
});

describe("bill types", () => {
  it("understands the usual spellings", () => {
    expect(parsePurchaseBillType("VAT")).toBe("vat");
    expect(parsePurchaseBillType("Pan Bill")).toBe("pan");
    expect(parsePurchaseBillType("no bill")).toBe("no_bill");
    expect(parsePurchaseBillType("no-bill")).toBe("no_bill");
    expect(parsePurchaseBillType("Chalan")).toBe("challan");
    expect(parsePurchaseBillType("")).toBeUndefined();
    expect(parsePurchaseBillType("whatever")).toBeNull();
  });
});

const base: PurchaseRowInput = {
  dateIso: "2026-09-10",
  periodLocked: false,
  amount: { value: 1000, invalid: false },
  discount: { value: null, invalid: false },
  billType: undefined,
  paid: { value: null, invalid: false },
  account: "none",
  supplier: "matched",
  category: "ok",
  duplicate: false,
  settings: { amountsIncludeVat: false, vatRate: 13, defaultBillType: "vat", paidMode: "file", hasDefaultAccount: false },
};
const check = (over: Partial<PurchaseRowInput> = {}, settings: Partial<PurchaseRowInput["settings"]> = {}) => checkPurchaseRow({ ...base, ...over, settings: { ...base.settings, ...settings } });

describe("whether a purchase row can be imported", () => {
  it("accepts a sound unpaid VAT bill from a known supplier, with VAT worked out", () => {
    const r = check();
    expect(r.status).toBe("ready");
    expect(r.computed).toMatchObject({ subtotal: 1000, tax: 130, total: 1130, paid: 0, billType: "vat" });
  });
  it("only a VAT bill carries VAT", () => {
    expect(check({ billType: "pan" }).computed).toMatchObject({ tax: 0, total: 1000, billType: "pan" });
    expect(check({ billType: "no_bill" }).computed?.tax).toBe(0);
  });
  it("flags what can't be read, one issue each", () => {
    expect(check({ dateIso: null, dateNote: "Not a date" }).issues).toEqual(["date"]);
    expect(check({ periodLocked: true }).issues).toEqual(["locked"]);
    expect(check({ amount: { value: null, invalid: true } }).issues).toEqual(["amount"]);
    expect(check({ amount: { value: -5, invalid: false } }).messages[0]).toMatch(/purchase return/);
    expect(check({ billType: null, billTypeText: "x" }).issues).toEqual(["billType"]);
  });
  it("needs a category, which can come from the file or a default", () => {
    expect(check({ category: "none" }).issues).toEqual(["category"]);
    expect(check({ category: "unknown", categoryText: "Stationary" }).messages[0]).toMatch(/Stationary/);
  });
  it("lets a fully paid bill go without a supplier, but not a part-paid one", () => {
    expect(check({ supplier: "none", account: "ok" }, { paidMode: "full" }).status).toBe("ready");
    expect(check({ supplier: "none" }).issues).toEqual(["supplier"]);
    expect(check({ supplier: "none", paid: { value: 500, invalid: false }, account: "ok" }).issues).toEqual(["supplier"]);
  });
  it("needs an account when money was paid, and refuses paying more than the bill", () => {
    expect(check({ paid: { value: 1130, invalid: false } }).issues).toEqual(["account"]);
    expect(check({ paid: { value: 1130, invalid: false } }, { hasDefaultAccount: true }).status).toBe("ready");
    expect(check({ paid: { value: 5000, invalid: false }, account: "ok" }).issues).toEqual(["paid"]);
  });
  it("an unknown supplier is a pending decision; ticked-to-create and skipped behave", () => {
    expect(check({ supplier: "unknown" }).issues).toEqual(["supplier"]);
    expect(check({ supplier: "create" }).status).toBe("ready");
    expect(check({ supplier: "skipped" }).status).toBe("skipped");
    expect(check({ category: "skipped" }).status).toBe("skipped");
  });
  it("reports a duplicate only when nothing else is wrong", () => {
    expect(check({ duplicate: true }).status).toBe("duplicate");
    expect(check({ duplicate: true, dateIso: null }).status).toBe("attention");
  });
  it("amounts that include VAT are worked back, but only on a VAT bill", () => {
    expect(check({ amount: { value: 1130, invalid: false } }, { amountsIncludeVat: true }).computed).toMatchObject({ subtotal: 1000, tax: 130, total: 1130 });
    expect(check({ amount: { value: 1130, invalid: false }, billType: "pan" }, { amountsIncludeVat: true }).computed).toMatchObject({ subtotal: 1130, tax: 0, total: 1130 });
  });
});
