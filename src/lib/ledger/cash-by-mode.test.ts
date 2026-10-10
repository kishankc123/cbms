import { describe, expect, it } from "vitest";
import { groupByMode, NO_MODE_LABEL } from "./cash-by-mode-rules";

const line = (modeName: string | null, accountId: string, entryId: string, debit: number, credit: number) => ({ modeName, accountId, entryId, debit, credit });

describe("receipts and payments by mode", () => {
  it("adds money in and out up per mode, counting each transaction once", () => {
    const { byMode } = groupByMode([line("Cash", "a", "e1", 500, 0), line("Cash", "a", "e2", 0, 120), line("Fonepay", "w", "e3", 300, 0), line("Fonepay", "w", "e3", 0, 0)]);
    expect(byMode).toEqual([
      { mode: "Cash", received: 500, paid: 120, net: 380, transactions: 2 },
      { mode: "Fonepay", received: 300, paid: 0, net: 300, transactions: 1 },
    ]);
  });
  it("puts lines with no recorded mode in their own row, last", () => {
    const { byMode } = groupByMode([line(null, "a", "e1", 9000, 0), line("Cheque", "b", "e2", 100, 0)]);
    expect(byMode.map((m) => m.mode)).toEqual(["Cheque", NO_MODE_LABEL]);
  });
  it("splits a mode by the account it went through (a bank taking cheques and transfers)", () => {
    const { byModeAndAccount } = groupByMode([line("Cheque", "bank1", "e1", 100, 0), line("Cheque", "bank2", "e2", 50, 0), line("Cheque", "bank1", "e3", 25, 0)]);
    expect(byModeAndAccount).toEqual([
      { mode: "Cheque", accountId: "bank1", received: 125, paid: 0, transactions: 2 },
      { mode: "Cheque", accountId: "bank2", received: 50, paid: 0, transactions: 1 },
    ]);
  });
  it("is empty when nothing moved", () => {
    expect(groupByMode([])).toEqual({ byMode: [], byModeAndAccount: [] });
  });
});
