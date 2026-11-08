import { describe, expect, it } from "vitest";
import { buildDaybook, NO_MODE, ON_CREDIT, type DayEntry, type DayLine } from "./daybook-rules";

const CASH = "cash";
const BANK = "bank";
const cashAccounts = [{ id: CASH, code: "1000", name: "Cash" }, { id: BANK, code: "1010", name: "Bank" }];
const l = (accountId: string, debit: number, credit: number, modeName: string | null = null): DayLine => ({ accountId, debit, credit, modeName });
const e = (id: string, sourceType: string, sourceId: string | null, lines: DayLine[], over: Partial<DayEntry> = {}): DayEntry => ({ id, sourceType, sourceId, isReversed: false, reversalOfId: null, lines, ...over });

const entries: DayEntry[] = [
  e("s1", "sale", "inv1", [l("ar", 10000, 0), l("rev", 0, 8850), l("vat", 0, 1150)]),
  e("r1", "receipt", "inv1", [l(CASH, 4000, 0, "Cash"), l(BANK, 3000, 0, "Fonepay"), l("ar", 0, 7000)]), // paid with the sale
  e("p1", "purchase", "bill1", [l("purch", 5000, 0), l(CASH, 0, 2000, "Cash"), l("ap", 0, 3000)]),
  e("y2", "payment", "bill1", [l("ap", 500, 0), l(BANK, 0, 500, "Fonepay")]), // part of the same bill paid later the same day
  e("x1", "expense", "exp1", [l("rent", 1500, 0), l(BANK, 0, 1500, "Fonepay")]),
  e("r2", "receipt", "pay9", [l(BANK, 2500, 0, "Bank transfer"), l("ar", 0, 2500)]), // collected from an earlier credit sale
  e("y1", "payment", "pay10", [l("ap", 1000, 0), l(CASH, 0, 1000, "Cash")]),
  e("t1", "inter_transfer", "tr1", [l(CASH, 800, 0), l(BANK, 0, 800)]),
  // an invoice edited on the same day: the old entry and its reversal cancel, the new one counts
  e("old", "sale", "inv2", [l("ar", 600, 0), l("rev", 0, 600)], { isReversed: true }),
  e("old-rev", "sale", "inv2", [l("ar", 0, 600), l("rev", 600, 0)], { reversalOfId: "old" }),
  e("new", "sale", "inv2", [l("ar", 600, 0), l("rev", 0, 600)]),
  // an older correction: the reversal of something on another day
  e("z", "receipt", "x", [l(CASH, 0, 200, "Cash"), l("ar", 200, 0)], { reversalOfId: "another-day" }),
];
const opening = { [CASH]: 10000, [BANK]: 50000 };
const closing = { [CASH]: 11600, [BANK]: 52700 };
const d = buildDaybook({ day: "2026-11-08", entries, cashAccounts, opening, closing });

describe("sales, purchases and expenses of the day, by how they were settled", () => {
  it("sales: the invoices of the day (an edited one counts once), money received with them by mode, the rest on credit", () => {
    expect(d.sales.total).toBe(10600);
    expect(d.sales.count).toBe(3 - 1); // the invoice and the edited one; the cancelled pair is not counted
    expect(d.sales.byMode).toEqual([{ mode: "Cash", amount: 4000 }, { mode: "Fonepay", amount: 3000 }, { mode: ON_CREDIT, amount: 3600 }]);
  });
  it("purchases: paid from the entry itself and by a payment against the same bill, by mode", () => {
    expect(d.purchases.total).toBe(5000);
    expect(d.purchases.byMode).toEqual([{ mode: "Cash", amount: 2000 }, { mode: "Fonepay", amount: 500 }, { mode: ON_CREDIT, amount: 2500 }]);
  });
  it("expenses: paid by mode, with nothing on credit when fully paid", () => {
    expect(d.expenses.total).toBe(1500);
    expect(d.expenses.byMode).toEqual([{ mode: "Fonepay", amount: 1500 }]);
  });
});

describe("money in and out, and everything that is not a sale, purchase or expense", () => {
  it("totals every money line once", () => {
    expect(d.moneyIn).toBe(9500); // 4000 + 3000 + 2500
    expect(d.moneyOut).toBe(5200); // 2000 + 1500 + 1000 + 500 + 200
    expect(d.net).toBe(4300);
  });
  it("lists collections, payments to others and corrections apart, and keeps moves between own accounts out", () => {
    expect(d.other).toEqual([
      { key: "receipt", label: "Collected from customers", in: 2500, out: 0 },
      { key: "payment", label: "Paid to suppliers and others", in: 0, out: 1000 },
      { key: "corrections", label: "Corrections of earlier entries", in: 0, out: 200 },
    ]);
    expect(d.transfersMoved).toBe(800);
  });
  it("a payment against the day's own bill is a purchase payment, not 'paid to others'", () => {
    expect(d.other.find((o) => o.key === "payment")!.out).toBe(1000);
  });
});

describe("cash and bank", () => {
  it("opening + in - out + moved between own accounts = closing, per account and in total, and agrees with the ledger", () => {
    const cash = d.accounts.find((a) => a.accountId === CASH)!;
    const bank = d.accounts.find((a) => a.accountId === BANK)!;
    expect(cash).toMatchObject({ opening: 10000, in: 4000, out: 3200, transfers: 800, closing: 11600, group: "cash" });
    expect(bank).toMatchObject({ opening: 50000, in: 5500, out: 2000, transfers: -800, closing: 52700, group: "bank" });
    expect(d.totals).toEqual({ opening: 60000, in: 9500, out: 5200, transfers: 0, closing: 64300 });
    expect(d.groups.map((g) => g.label)).toEqual(["Cash", "Bank and wallets"]);
    expect(d.reconciles).toBe(true);
  });
  it("says so when an account's ledger closing balance does not match", () => {
    expect(buildDaybook({ day: "2026-11-08", entries, cashAccounts, opening, closing: { ...closing, [CASH]: 11000 } }).reconciles).toBe(false);
  });
  it("hides an account with nothing in it", () => {
    const quiet = buildDaybook({ day: "2026-11-08", entries: [], cashAccounts: [...cashAccounts, { id: "old", code: "1010.9", name: "Old wallet" }], opening: { cash: 5, old: 0 }, closing: { cash: 5, old: 0 } });
    expect(quiet.accounts.map((a) => a.name)).toEqual(["Cash"]);
  });
});

describe("a quiet day", () => {
  it("shows zeros, balances carried through, and the mode label when none was saved", () => {
    const empty = buildDaybook({ day: "2026-11-08", entries: [], cashAccounts, opening: { cash: 100, bank: 200 }, closing: { cash: 100, bank: 200 } });
    expect(empty).toMatchObject({ moneyIn: 0, moneyOut: 0, sales: { total: 0, byMode: [] }, totals: { opening: 300, closing: 300 }, reconciles: true });
    const unmoded = buildDaybook({ day: "2026-11-08", entries: [e("a", "expense", "q", [l("rent", 50, 0), l(CASH, 0, 50)])], cashAccounts, opening: { cash: 50 }, closing: { cash: 0 } });
    expect(unmoded.expenses.byMode).toEqual([{ mode: NO_MODE, amount: 50 }]);
  });
});
