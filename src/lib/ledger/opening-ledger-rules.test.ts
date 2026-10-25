import { describe, expect, it } from "vitest";
import { buildOpeningLines, otherScreenFor, sheetTotals } from "./opening-ledger-rules";

const BF = "bf";
const t = (accountId: string, netDebit: number) => ({ accountId, name: accountId, netDebit });
const sum = (lines: { debitAmount?: number; creditAmount?: number }[], side: "debitAmount" | "creditAmount") => Math.round(lines.reduce((s, l) => s + (l[side] ?? 0), 0) * 100) / 100;

describe("opening balances sheet", () => {
  it("debits and credits as typed, and balances the rest to Brought forward", () => {
    const lines = buildOpeningLines([t("prepaid", 1000), t("loan", -300), t("capital", -200)], BF);
    expect(lines).toEqual([
      { accountId: "prepaid", debitAmount: 1000, description: "Opening balance - prepaid" },
      { accountId: "loan", creditAmount: 300, description: "Opening balance - loan" },
      { accountId: "capital", creditAmount: 200, description: "Opening balance - capital" },
      { accountId: BF, creditAmount: 500, description: "Opening balance - balancing figure" },
    ]);
    expect(sum(lines, "debitAmount")).toBe(sum(lines, "creditAmount"));
  });

  it("debits Brought forward when credits exceed debits", () => {
    const lines = buildOpeningLines([t("prepaid", 100), t("loan", -50), t("accdep", -320)], BF);
    expect(sum(lines, "debitAmount")).toBe(sum(lines, "creditAmount"));
    expect(lines.at(-1)).toMatchObject({ accountId: BF, debitAmount: 270 });
  });

  it("posts nothing for an empty sheet and no balancing line when it already balances", () => {
    expect(buildOpeningLines([t("prepaid", 0)], BF)).toEqual([]);
    expect(buildOpeningLines([t("prepaid", 100), t("capital", -100)], BF)).toHaveLength(2);
  });

  it("sends stock and fixed assets to their own screens, and nothing else", () => {
    expect(otherScreenFor("1200")).toBe("/inventory/stock");
    for (const code of ["1500", "1590"]) expect(otherScreenFor(code)).toBe("/assets");
    for (const code of ["1000", "1010.02", "1100", "1300", "2200", "3000", "12000"]) expect(otherScreenFor(code)).toBeNull();
  });

  it("totals debits and credits", () => {
    expect(sheetTotals([1000, -300, -200, 0, -500])).toEqual({ debit: 1000, credit: 1000 });
  });
});
