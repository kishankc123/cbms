import { describe, expect, it } from "vitest";
import { buildCashFlowByAccount, type FlowAccount, type FlowEntry } from "./cashflow-by-account-rules";

const acct = (id: string, code: string, name: string, category: string, extra: Partial<FlowAccount> = {}): FlowAccount => ({ id, code, name, category, subCategory: null, parentId: null, ...extra });
const infos = new Map<string, FlowAccount>(
  [
    acct("cash", "1000.1", "Cash", "asset"),
    acct("bank", "1010.1", "NIMB", "asset"),
    acct("ar", "1100", "Accounts Receivable", "asset"),
    acct("ar-ram", "1100.1", "Ram Traders", "asset", { parentId: "ar" }),
    acct("ap", "2000", "Accounts Payable", "liability"),
    acct("ap-k", "2000.1", "K liquor store", "liability", { parentId: "ap" }),
    acct("ap-m", "2000.2", "Makalu beverage", "liability", { parentId: "ap" }),
    acct("inv", "1200", "Inventory", "asset"),
    acct("food", "4000.1", "Food sales", "income"),
    acct("liq", "4000.2", "Liquor sales", "income"),
    acct("light", "5300", "Light bills", "expense", { subCategory: "Indirect expenses" }),
    acct("rent", "5100", "Rent", "expense", { subCategory: "Indirect expenses" }),
    acct("cogs", "5000", "Cost of Goods Sold", "expense", { subCategory: "Cost of goods sold" }),
    acct("short", "5930", "Cash short and excess", "expense"),
    acct("div", "3100", "Dividends", "equity"),
  ].map((a) => [a.id, a])
);
const cashAccounts = [
  { id: "cash", name: "Cash", code: "1000.1", opening: 1000, ledgerClosing: 0 },
  { id: "bank", name: "NIMB", code: "1010.1", opening: 0, ledgerClosing: 0 },
];
const entry = (id: string, sourceType: string, lines: [string, number, number][], extra: Partial<FlowEntry> = {}): FlowEntry => ({
  id,
  sourceType,
  paymentType: null,
  origin: null,
  revenue: [],
  lines: lines.map(([accountId, debit, credit]) => ({ accountId, debit, credit })),
  ...extra,
});
const run = (entries: FlowEntry[], closings?: [number, number]) => {
  const cash = cashAccounts.map((c, i) => ({ ...c, ledgerClosing: closings ? closings[i] : c.ledgerClosing }));
  return buildCashFlowByAccount(entries, cash, infos, { showEmptyAccounts: true });
};
const line = (r: ReturnType<typeof run>, side: "moneyIn" | "moneyOut", section: string, label: string) => r[side].sections.find((s) => s.title === section)?.lines.find((l) => l.label === label);

describe("cash flow by account", () => {
  it("puts a sale paid on the spot on the revenue accounts of its invoice, in the column of the account it was paid into", () => {
    const r = run([entry("1", "receipt", [["bank", 1130, 0], ["ar-ram", 0, 1130]], { origin: "embedded", paymentType: "customer_payment", revenue: [{ accountId: "food", weight: 300 }, { accountId: "liq", weight: 700 }] })]);
    expect(line(r, "moneyIn", "Sales", "Food sales")?.cells).toEqual([0, 339]);
    expect(line(r, "moneyIn", "Sales", "Liquor sales")?.cells).toEqual([0, 791]);
    expect(r.moneyIn.cells).toEqual([0, 1130]);
  });

  it("shows a later payment from a customer under Receivables, with the customer as the row to expand", () => {
    const r = run([entry("1", "receipt", [["cash", 500, 0], ["ar-ram", 0, 500]], { paymentType: "customer_payment", origin: "standalone" })]);
    const l = line(r, "moneyIn", "Receivables", "Payment received")!;
    expect(l.cells).toEqual([500, 0]);
    expect(l.children.map((c) => [c.label, c.total])).toEqual([["Ram Traders", 500]]);
  });

  it("shows money out in negative, by expense account, and keeps rent and salaries in their own section", () => {
    const r = run([
      entry("1", "expense", [["light", 400, 0], ["bank", 0, 400]]),
      entry("2", "expense", [["rent", 6000, 0], ["bank", 0, 6000]]),
      entry("3", "expense", [["cogs", 250, 0], ["cash", 0, 250]]),
    ]);
    expect(line(r, "moneyOut", "Operational expenses", "Light bills")?.cells).toEqual([0, -400]);
    expect(line(r, "moneyOut", "Salary and rent", "Rent")?.cells).toEqual([0, -6000]);
    expect(line(r, "moneyOut", "Purchases", "Cost of Goods Sold")?.cells).toEqual([-250, 0]);
    expect(r.moneyOut.cells).toEqual([-250, -6400]);
  });

  it("lists suppliers paid under one row that expands to each supplier", () => {
    const r = run([
      entry("1", "payment", [["ap-k", 900, 0], ["bank", 0, 900]], { paymentType: "supplier_payment" }),
      entry("2", "payment", [["ap-m", 100, 0], ["bank", 0, 100]], { paymentType: "supplier_payment" }),
    ]);
    const l = line(r, "moneyOut", "Payables", "Paid to suppliers")!;
    expect(l.total).toBe(-1000);
    expect(l.children.map((c) => [c.label, c.total])).toEqual([["K liquor store", -900], ["Makalu beverage", -100]]);
  });

  it("a stockable purchase paid at once is a purchase, not a payment to a supplier", () => {
    const r = run([entry("1", "purchase", [["inv", 1000, 0], ["cash", 0, 400], ["ap-k", 0, 600]])]);
    expect(line(r, "moneyOut", "Purchases", "Stock purchases")?.cells).toEqual([-400, 0]);
    expect(r.moneyOut.sections.find((s) => s.title === "Payables")).toBeUndefined();
  });

  it("shows a move between two accounts as out of one and into the other, cancelling in the total", () => {
    const r = run([entry("1", "inter_transfer", [["bank", 700, 0], ["cash", 0, 700]])]);
    expect(line(r, "moneyIn", "Other", "Inter-transfer in")?.cells).toEqual([0, 700]);
    expect(line(r, "moneyOut", "Other", "Inter-transfer out")?.cells).toEqual([-700, 0]);
    expect(r.hasTransfers).toBe(true);
    expect(r.moneyIn.total + r.moneyOut.total).toBe(0);
  });

  it("shows what the cash count found: over is money in, short is money out", () => {
    const r = run([entry("1", "expense", [["cash", 30, 0], ["short", 0, 30]]), entry("2", "expense", [["short", 10, 0], ["cash", 0, 10]])]);
    expect(line(r, "moneyIn", "Other", "Cash over (counter closing)")?.total).toBe(30);
    expect(line(r, "moneyOut", "Other", "Cash short (counter closing)")?.total).toBe(-10);
  });

  it("puts anything else on a row of its own account under Other", () => {
    const r = run([entry("1", "payment", [["div", 495, 0], ["bank", 0, 495]])]);
    expect(line(r, "moneyOut", "Other", "Dividends")?.cells).toEqual([0, -495]);
  });

  it("the opening balances entered at the start are part of the opening line, not money in", () => {
    const r = run([entry("0", "opening_balance", [["cash", 5000, 0], ["div", 0, 5000]]), entry("1", "payment", [["light", 100, 0], ["cash", 0, 100]])], [4900, 0]);
    expect(r.opening).toEqual([6000, 0]);
    expect(r.moneyIn.total).toBe(0);
    expect(r.closing).toEqual([5900, 0]);
    expect(r.balanced).toBe(false); // the ledger says 4900 here: the test's own ledger figure, which the check reports as a difference
    expect(r.differences[0]).toBe(-1000);
  });

  it("agrees with the ledger when every movement is counted, and says so", () => {
    const r = run([entry("1", "receipt", [["cash", 200, 0], ["ar-ram", 0, 200]], { paymentType: "customer_payment" }), entry("2", "payment", [["light", 50, 0], ["cash", 0, 50]])], [1150, 0]);
    expect(r.balanced).toBe(true);
    expect(r.closing).toEqual([1150, 0]);
  });

  it("leaves out an account that did nothing unless asked for", () => {
    const cash = cashAccounts.map((c) => ({ ...c, opening: c.id === "cash" ? 10 : 0, ledgerClosing: c.id === "cash" ? 10 : 0 }));
    expect(buildCashFlowByAccount([], cash, infos).columns.map((c) => c.name)).toEqual(["Cash"]);
    expect(buildCashFlowByAccount([], cash, infos, { showEmptyAccounts: true }).columns.map((c) => c.name)).toEqual(["Cash", "NIMB"]);
  });

  it("spreads a payment over several revenue accounts without losing a paisa", () => {
    const r = run([entry("1", "receipt", [["cash", 100, 0], ["ar-ram", 0, 100]], { origin: "embedded", revenue: [{ accountId: "food", weight: 1 }, { accountId: "liq", weight: 1 }, { accountId: "food", weight: 1 }] })]);
    const sales = r.moneyIn.sections.find((s) => s.title === "Sales")!;
    expect(sales.total).toBeCloseTo(100, 1);
  });
});
