import { describe, expect, it } from "vitest";
import { netFromInclusive, rowTotals } from "./amounts";
import { checkRow, type RowCheckInput } from "./checks";
import { headerSignature, mappingComplete, suggestMapping } from "./fields";
import { bestNameMatch, nameSimilarity, normalizeName, parseAmountCell, parseBillTypeCell } from "./values";

describe("matching a file's headers to the columns", () => {
  it("finds the usual names, once each", () => {
    expect(suggestMapping(["Invoice Date", "Party Name", "Taxable Amount", "VAT Amount", "Discount", "Paid"])).toEqual({
      date: "Invoice Date",
      customer: "Party Name",
      amount: "Taxable Amount",
      discount: "Discount",
      paid: "Paid",
    });
  });
  it("keeps Amount for the amount and never takes a VAT Amount column for the bill type", () => {
    const m = suggestMapping(["Date", "Customer", "Amount", "VAT Amount", "Total", "Bill Type"]);
    expect(m).toMatchObject({ amount: "Amount", billType: "Bill Type" });
  });
  it("knows when a required column is missing", () => {
    expect(mappingComplete(suggestMapping(["Date", "Customer"]))).toBe(false);
    expect(mappingComplete(suggestMapping(["Date", "Customer", "Amount"]))).toBe(true);
  });
  it("gives the same fingerprint however the headers are cased or ordered", () => {
    expect(headerSignature(["Date", "Customer", "Amount"])).toBe(headerSignature(["amount", " DATE ", "customer"]));
    expect(headerSignature(["Date", "Customer", "Amount"])).not.toBe(headerSignature(["Date", "Customer", "Qty"]));
  });
});

describe("reading cells", () => {
  it("reads money the way spreadsheets write it", () => {
    expect(parseAmountCell("1,234.50")).toEqual({ value: 1234.5, invalid: false });
    expect(parseAmountCell("Rs. 1,000")).toEqual({ value: 1000, invalid: false });
    expect(parseAmountCell("(500)")).toEqual({ value: -500, invalid: false });
    expect(parseAmountCell("")).toEqual({ value: null, invalid: false });
    expect(parseAmountCell("abc")).toEqual({ value: null, invalid: true });
  });
  it("understands bill types", () => {
    expect(parseBillTypeCell("Taxable")).toBe("taxable");
    expect(parseBillTypeCell("13%")).toBe("taxable");
    expect(parseBillTypeCell("Zero rated")).toBe("zero_rated");
    expect(parseBillTypeCell("exempt")).toBe("zero_rated");
    expect(parseBillTypeCell("")).toBeUndefined();
    expect(parseBillTypeCell("maybe")).toBeNull();
  });
  it("matches near-identical names, whatever the case, punctuation or order", () => {
    expect(normalizeName("  Himal  Enterprises Pvt. Ltd. ")).toBe("himal enterprises pvt ltd");
    expect(nameSimilarity("Himal Enterprises", "HIMAL ENTERPRISES.")).toBe(1);
    expect(nameSimilarity("Enterprises Himal", "Himal Enterprises")).toBeGreaterThan(0.95);
    expect(bestNameMatch("Himal Entrprises", [{ name: "Acme Traders" }, { name: "Himal Enterprises" }])?.match.name).toBe("Himal Enterprises");
    expect(bestNameMatch("Zebra Corp", [{ name: "Acme Traders" }, { name: "Himal Enterprises" }])).toBeNull();
  });
});

describe("the money of a row", () => {
  it("adds VAT after the discount, never on a zero-rated bill", () => {
    expect(rowTotals(1000, 100, "taxable", 13)).toEqual({ gross: 1000, discount: 100, subtotal: 900, tax: 117, total: 1017 });
    expect(rowTotals(1000, 0, "zero_rated", 13).tax).toBe(0);
  });
  it("works an amount that includes VAT back to the amount before VAT, to the cent", () => {
    for (const total of [1130, 113, 999.99, 1234.57, 56.5, 0.5]) {
      const net = netFromInclusive(total, 13);
      expect(rowTotals(net, 0, "taxable", 13).total).toBe(total);
    }
    expect(netFromInclusive(500, 0)).toBe(500);
  });
});

const base: RowCheckInput = {
  dateIso: "2026-09-10",
  periodLocked: false,
  amount: { value: 1000, invalid: false },
  discount: { value: null, invalid: false },
  billType: undefined,
  paid: { value: null, invalid: false },
  account: "none",
  customer: "matched",
  duplicate: false,
  settings: { amountsIncludeVat: false, vatRate: 13, defaultBillType: "taxable", paidMode: "file", hasDefaultAccount: false },
};
const check = (over: Partial<RowCheckInput> = {}, settings: Partial<RowCheckInput["settings"]> = {}) => checkRow({ ...base, ...over, settings: { ...base.settings, ...settings } });

describe("whether a row can be imported", () => {
  it("accepts a sound unpaid row for a known customer, with VAT worked out", () => {
    const r = check();
    expect(r.status).toBe("ready");
    expect(r.computed).toMatchObject({ subtotal: 1000, tax: 130, total: 1130, paid: 0, billType: "taxable" });
  });
  it("flags what can't be read, one issue each", () => {
    expect(check({ dateIso: null, dateNote: "Not a date" }).issues).toEqual(["date"]);
    expect(check({ periodLocked: true }).issues).toEqual(["locked"]);
    expect(check({ amount: { value: null, invalid: true } }).issues).toEqual(["amount"]);
    expect(check({ amount: { value: -5, invalid: false } }).messages[0]).toMatch(/sales return/);
    expect(check({ discount: { value: 2000, invalid: false } }).issues).toEqual(["discount"]);
    expect(check({ billType: null, billTypeText: "maybe" }).issues).toEqual(["billType"]);
  });
  it("lets a fully paid sale go without a customer, but not a part-paid one", () => {
    const paidFull = check({ customer: "none", account: "ok" }, { paidMode: "full" });
    expect(paidFull.status).toBe("ready");
    expect(check({ customer: "none" }).issues).toEqual(["customer"]);
    expect(check({ customer: "none", paid: { value: 500, invalid: false }, account: "ok" }).issues).toEqual(["customer"]);
  });
  it("needs an account when money was received, from the file or the default", () => {
    expect(check({ paid: { value: 1130, invalid: false } }).issues).toEqual(["account"]);
    expect(check({ paid: { value: 1130, invalid: false } }, { hasDefaultAccount: true }).status).toBe("ready");
    expect(check({ paid: { value: 1130, invalid: false }, account: "unknown", accountText: "Petty" }).messages[0]).toMatch(/isn't one of your cash, bank or wallet/);
  });
  it("refuses more paid than the invoice total", () => {
    expect(check({ paid: { value: 2000, invalid: false }, account: "ok" }).issues).toEqual(["paid"]);
  });
  it("an unknown customer is a pending decision, and a skipped row is just skipped", () => {
    expect(check({ customer: "unknown" }).issues).toEqual(["customer"]);
    expect(check({ customer: "create" }).status).toBe("ready");
    expect(check({ customer: "skipped" }).status).toBe("skipped");
  });
  it("reports a duplicate only when nothing else is wrong", () => {
    expect(check({ duplicate: true }).status).toBe("duplicate");
    expect(check({ duplicate: true, dateIso: null }).status).toBe("attention");
  });
  it("amounts that include VAT: the invoice total is the file's amount", () => {
    const r = check({ amount: { value: 1130, invalid: false } }, { amountsIncludeVat: true });
    expect(r.computed).toMatchObject({ subtotal: 1000, tax: 130, total: 1130 });
    expect(check({ amount: { value: 1130, invalid: false }, billType: "zero_rated" }, { amountsIncludeVat: true }).computed).toMatchObject({ subtotal: 1130, tax: 0, total: 1130 });
  });
});
