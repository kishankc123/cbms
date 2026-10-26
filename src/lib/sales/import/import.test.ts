import { describe, expect, it } from "vitest";
import { netFromInclusive, rowTotals } from "./amounts";
import { checkRow, type RowCheckInput } from "./checks";
import { assertColumns, templateMapping } from "@/lib/import-columns";
import { noPays, pays, slot } from "@/test/import-pays";
import { IMPORT_FIELDS } from "./fields";
import { bestNameMatch, nameSimilarity, normalizeName, parseAmountCell, parseBillTypeCell } from "./values";

describe("reading a file's columns", () => {
  it("finds each column by its name in the template, whatever the capitals, spaces or punctuation", () => {
    expect(templateMapping(IMPORT_FIELDS, ["Date", "customer", "AMOUNT", "Bill  type", "Paid amount", "received-into"])).toEqual({
      date: "Date",
      customer: "customer",
      amount: "AMOUNT",
      billType: "Bill  type",
      paid: "Paid amount",
      account: "received-into",
    });
  });
  it("finds the second and third payment columns too", () => {
    expect(templateMapping(IMPORT_FIELDS, ["Paid amount 2", "Received into 2", "Paid amount 3", "Received into 3"])).toEqual({ paid2: "Paid amount 2", account2: "Received into 2", paid3: "Paid amount 3", account3: "Received into 3" });
  });
  it("does not guess at other names", () => {
    expect(templateMapping(IMPORT_FIELDS, ["Invoice Date", "Party Name", "Taxable Amount"])).toEqual({});
  });
  it("refuses a file without a required column, and says what to do", () => {
    expect(() => assertColumns(IMPORT_FIELDS, templateMapping(IMPORT_FIELDS, ["Date", "Customer"]))).toThrow(/no "Amount" column.*template/);
    expect(() => assertColumns(IMPORT_FIELDS, templateMapping(IMPORT_FIELDS, ["Date", "Customer", "Amount"]))).not.toThrow();
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
  amount: { value: 1130, invalid: false },
  discount: { value: null, invalid: false },
  billType: undefined,
  pays: noPays,
  customer: "matched",
  duplicate: false,
  settings: { vatRate: 13, defaultBillType: "taxable", paidMode: "file", hasDefaultAccount: false },
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
    const paidFull = check({ customer: "none", pays: pays(null, "ok") }, { paidMode: "full" });
    expect(paidFull.status).toBe("ready");
    expect(check({ customer: "none" }).issues).toEqual(["customer"]);
    expect(check({ customer: "none", pays: pays(500, "ok") }).issues).toEqual(["customer"]);
  });
  it("needs an account when money was received, from the file or the default", () => {
    expect(check({ pays: pays(1130) }).issues).toEqual(["account"]);
    expect(check({ pays: pays(1130) }, { hasDefaultAccount: true }).status).toBe("ready");
    expect(check({ pays: pays(1130, "unknown", "Petty") }).messages[0]).toMatch(/isn't one of your cash, bank or wallet/);
  });
  it("takes a payment in parts, each through its own account", () => {
    const split = (second: ReturnType<typeof slot>) => [slot({ amount: { value: 600, invalid: false }, account: "ok" }), second, slot()];
    const ok = check({ pays: split(slot({ amount: { value: 530, invalid: false }, account: "ok" })) });
    expect(ok.status).toBe("ready");
    expect(ok.computed).toMatchObject({ total: 1130, paid: 1130 });
    expect(check({ pays: split(slot({ amount: { value: 530, invalid: false } })) }).issues).toEqual(["account"]); // the second part names no account
    expect(check({ pays: split(slot({ amount: { value: 600, invalid: false }, account: "ok" })) }).issues).toEqual(["paid"]); // together more than the total
    expect(check({ pays: split(slot({ amount: { value: null, invalid: true }, account: "ok" })) }).messages[0]).toMatch(/Payment 2: The paid amount isn't a number/);
  });
  it("refuses more paid than the invoice total", () => {
    expect(check({ pays: pays(2000, "ok") }).issues).toEqual(["paid"]);
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
  it("the amount includes VAT: the invoice total is the file's amount, less any discount", () => {
    expect(check().computed).toMatchObject({ subtotal: 1000, tax: 130, total: 1130 });
    expect(check({ discount: { value: 113, invalid: false } }).computed).toMatchObject({ subtotal: 900, tax: 117, total: 1017 });
    expect(check({ billType: "zero_rated" }).computed).toMatchObject({ subtotal: 1130, tax: 0, total: 1130 });
  });
});
