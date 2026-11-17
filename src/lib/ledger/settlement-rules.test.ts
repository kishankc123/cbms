import { describe, expect, it } from "vitest";
import { ledgerLabel, matchLedgerAccount, settlementAccounts, type LedgerAccount } from "./settlement-rules";

const a = (id: string, code: string, name: string, category: string, parentId: string | null = null, isActive = true): LedgerAccount & { isActive: boolean } => ({ id, code, name, category, parentId, isActive });
const SYSTEM = new Set(["1100", "2000", "2100", "3000", "4000"]);
const chart = [
  a("ar", "1100", "Accounts Receivable", "asset"), a("himal", "1100.01", "Himal Enterprises", "asset", "ar"),
  a("vat", "2100", "Tax Payable", "liability"), a("vat1", "2100.01", "Output VAT", "liability", "vat"),
  a("dir", "2400", "Director", "liability"), a("sudip", "2400.01", "Sudip KC", "liability", "dir"), a("old", "2400.02", "Closed", "liability", "dir", false),
  a("cap", "3000", "Owner's Capital", "equity"), a("sales", "4000", "Sales", "income"), a("rent", "5100", "Rent", "expense"),
  a("stock", "1200", "Inventory", "asset"), a("a2", "2500", "Sudip KC", "liability"),
  a("bank", "1010", "Bank", "asset"), a("nabil", "1010.01", "Nabil", "asset", "bank"), a("till", "1000", "Cash", "asset"), a("re", "3100", "Retained Earnings", "equity"),
];
const list = settlementAccounts(chart, new Set(["a2"]), SYSTEM);

describe("which accounts a payment can be settled through", () => {
  it("takes the lowest-level asset, liability and equity accounts", () => {
    expect(list.map((x) => x.id)).toEqual(["himal", "sudip", "cap"]);
  });
  it("leaves out cash and bank (offered through the payment modes), retained earnings, groups, inactive accounts, income, expenses, role accounts, app-managed ones (VAT, stock) and the receivable and payable controls", () => {
    for (const id of ["ar", "dir", "old", "sales", "rent", "vat", "vat1", "stock", "a2", "nabil", "till", "re"]) expect(list.some((x) => x.id === id)).toBe(false);
  });
  it("keeps equity even as a main account, and customer accounts so a receivable can be netted off", () => {
    expect(list.find((x) => x.id === "cap")).toMatchObject({ group: null });
    expect(list.find((x) => x.id === "himal")).toMatchObject({ group: "Accounts Receivable" });
  });
});

describe("reading an import cell", () => {
  it("understands Group: Name, with a colon or a >, in any case", () => {
    for (const t of ["Director: Sudip KC", "director>sudip kc", "  Director :  Sudip   KC ", "2400: Sudip KC"]) expect(matchLedgerAccount(t, list)).toMatchObject({ id: "sudip" });
  });
  it("understands a name or a code alone, and says no to what is not there", () => {
    expect(matchLedgerAccount("Sudip KC", list)).toMatchObject({ id: "sudip" });
    expect(matchLedgerAccount("2400.01", list)).toMatchObject({ id: "sudip" });
    expect(matchLedgerAccount("Other: Sudip KC", list)).toBeNull();
    expect(matchLedgerAccount("Nobody", list)).toBeNull();
  });
  it("lists the choices as Group: Name when a name fits more than one account", () => {
    const two = [...list, { id: "x", code: "2600.01", name: "Sudip KC", category: "liability", group: "Employee", groupCode: "2600" }];
    expect(matchLedgerAccount("Sudip KC", two)).toEqual({ ambiguous: ["Director: Sudip KC", "Employee: Sudip KC"] });
    expect(matchLedgerAccount("Employee: Sudip KC", two)).toMatchObject({ id: "x" });
    expect(ledgerLabel({ name: "Owner's Capital", group: null })).toBe("Owner's Capital");
  });
});
