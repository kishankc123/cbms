import { describe, expect, it } from "vitest";
import { checkExpenseRow, type ExpenseRowInput } from "./checks";
import { assertColumns, templateMapping } from "@/lib/import-columns";
import { noPays, pays } from "@/test/import-pays";
import { EXPENSE_FIELDS } from "./fields";

describe("reading an expense file's columns", () => {
  it("finds each column by its name in the template", () => {
    expect(templateMapping(EXPENSE_FIELDS, ["Date", "Category", "Supplier", "Description", "Invoice number", "Amount", "VAT amount", "TDS amount", "Due date", "Paid amount", "Paid from"])).toMatchObject({
      date: "Date",
      category: "Category",
      supplier: "Supplier",
      invoiceNumber: "Invoice number",
      amount: "Amount",
      vat: "VAT amount",
      tds: "TDS amount",
      dueDate: "Due date",
      paid: "Paid amount",
      account: "Paid from",
    });
  });
  it("needs only a date and an amount", () => {
    expect(() => assertColumns(EXPENSE_FIELDS, templateMapping(EXPENSE_FIELDS, ["Date", "Amount"]))).not.toThrow();
    expect(() => assertColumns(EXPENSE_FIELDS, templateMapping(EXPENSE_FIELDS, ["Date", "Category"]))).toThrow(/no "Amount" column/);
  });
});

const base: ExpenseRowInput = {
  dateIso: "2026-09-10",
  periodLocked: false,
  dueDate: { text: "", iso: null },
  amount: { value: 1000, invalid: false },
  billType: undefined,
  vat: { value: null, invalid: false },
  tds: { value: null, invalid: false },
  pays: noPays,
  supplier: "matched",
  category: "ok",
  duplicate: false,
  settings: { amountsIncludeVat: false, vatRate: 13, defaultBillType: "vat", paidMode: "file", hasDefaultAccount: false, blockedBy: () => null },
};
const check = (over: Partial<ExpenseRowInput> = {}, settings: Partial<ExpenseRowInput["settings"]> = {}) => checkExpenseRow({ ...base, ...over, settings: { ...base.settings, ...settings } });

describe("whether an expense row can be imported", () => {
  it("accepts a sound unpaid VAT expense, with VAT worked out", () => {
    const r = check();
    expect(r.status).toBe("ready");
    expect(r.computed).toMatchObject({ taxable: 1000, vat: 130, total: 1130, tds: 0, payable: 1130, paid: 0 });
  });
  it("only a VAT bill carries VAT", () => {
    expect(check({ billType: "pan" }).computed).toMatchObject({ vat: 0, total: 1000 });
  });
  it("takes the VAT amount from the file when there is one, and works it back out of an inclusive amount", () => {
    expect(check({ vat: { value: 100, invalid: false } }).computed).toMatchObject({ taxable: 1000, vat: 100, total: 1100 });
    expect(check({ vat: { value: 130, invalid: false }, amount: { value: 1130, invalid: false } }, { amountsIncludeVat: true }).computed).toMatchObject({ taxable: 1000, vat: 130, total: 1130 });
    expect(check({ amount: { value: 1130, invalid: false } }, { amountsIncludeVat: true }).computed).toMatchObject({ taxable: 1000, vat: 130, total: 1130 });
  });
  it("refuses VAT on a bill that isn't a VAT bill", () => {
    expect(check({ billType: "pan", vat: { value: 130, invalid: false } }).issues).toEqual(["vat"]);
  });
  it("TDS is withheld from what is payable, not added to the cost", () => {
    expect(check({ tds: { value: 100, invalid: false }, billType: "pan" }).computed).toMatchObject({ total: 1000, tds: 100, payable: 900 });
    expect(check({ tds: { value: 5000, invalid: false }, billType: "pan" }).issues).toEqual(["tds"]);
  });
  it("paid in full means paid what is payable, after TDS", () => {
    expect(check({ tds: { value: 100, invalid: false }, billType: "pan", supplier: "none", pays: pays(null, "ok") }, { paidMode: "full" })).toMatchObject({ status: "ready", computed: { paid: 900 } });
  });
  it("flags what can't be read, one issue each", () => {
    expect(check({ dateIso: null, dateNote: "Not a date" }).issues).toEqual(["date"]);
    expect(check({ periodLocked: true }).issues).toEqual(["locked"]);
    expect(check({ amount: { value: null, invalid: true } }).issues).toEqual(["amount"]);
    expect(check({ billType: null, billTypeText: "x" }).issues).toEqual(["billType"]);
    expect(check({ dueDate: { text: "soon", iso: null } }).issues).toEqual(["dueDate"]);
    expect(check({ dueDate: { text: "2026-09-01", iso: "2026-09-01" } }).issues).toEqual(["dueDate"]);
  });
  it("an audit rule that blocks an amount blocks the row", () => {
    expect(check({}, { blockedBy: (t) => (t > 1000 ? 'Blocked by rule "Large spend"' : null) }).issues).toEqual(["rule"]);
  });
  it("needs a category, and a supplier unless fully paid", () => {
    expect(check({ category: "none" }).issues).toEqual(["category"]);
    expect(check({ supplier: "none" }).issues).toEqual(["supplier"]);
    expect(check({ supplier: "none", pays: pays(null, "ok") }, { paidMode: "full" }).status).toBe("ready");
  });
  it("reports a duplicate only when nothing else is wrong", () => {
    expect(check({ duplicate: true }).status).toBe("duplicate");
    expect(check({ duplicate: true, dateIso: null }).status).toBe("attention");
  });
});
