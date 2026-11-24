import { describe, expect, it } from "vitest";
import { buildPartyRow, bucketOf, controlCheck, entriesTotal, sortRows, totalsOf } from "./party-balances-rules";
import type { PartyLine } from "./party-statement";

const line = (date: string, sourceType: string, debit: number, credit: number, extra: Partial<PartyLine> = {}): PartyLine => ({ date, debit, credit, sourceType, reference: null, memo: null, isReversal: false, ...extra });
const range = { from: "2026-11-01", to: "2026-11-30" };

describe("trade payables (credit normal)", () => {
  const lines = [
    line("2026-08-01", "opening_balance", 0, 1000, { entryId: "o" }),
    line("2026-10-10", "purchase", 0, 500, { entryId: "b0", reference: "OLD" }), // before the period: part of opening
    line("2026-11-03", "purchase", 0, 250, { entryId: "b1", reference: "INV-1" }),
    line("2026-11-09", "payment", 400, 0, { entryId: "p1" }),
    line("2026-11-12", "purchase_return", 50, 0, { entryId: "r1", reference: "CN-1" }),
    line("2026-11-20", "manual", 0, 30, { entryId: "m1", reference: "J-1" }),
  ];
  const row = buildPartyRow({ id: "s", name: "KTM", lines }, "credit", range);

  it("opens with the opening entry and everything before the period", () => {
    expect(row.opening).toBe(1500);
  });
  it("puts each entry in its column and rolls forward to the closing", () => {
    expect([row.inv, row.pay, row.ret, row.other]).toEqual([250, -400, -50, 30]);
    expect(row.closing).toBe(1330);
    expect(row.opening + row.inv + row.pay + row.ret + row.other).toBe(row.closing);
  });
  it("lists the entries with a running balance that ends at the closing", () => {
    expect(row.entries.map((e) => [e.reference, e.bucket, e.amount])).toEqual([["INV-1", "inv", 250], [null, "pay", -400], ["CN-1", "ret", -50], ["J-1", "other", 30]]);
    expect(row.entries.at(-1)!.balance).toBe(row.closing);
  });
  it("ignores entries after the period", () => {
    const later = buildPartyRow({ id: "s", name: "KTM", lines: [...lines, line("2026-12-02", "purchase", 0, 999, { entryId: "z" })] }, "credit", range);
    expect(later.closing).toBe(1330);
  });
});

describe("trade receivables (debit normal)", () => {
  it("counts a sale, a receipt and a sales return the other way round", () => {
    const row = buildPartyRow(
      { id: "c", name: "DJ", lines: [line("2026-11-02", "sale", 1000, 0, { entryId: "s1" }), line("2026-11-05", "receipt", 0, 600, { entryId: "r1" }), line("2026-11-06", "sales_return", 0, 100, { entryId: "sr" })] },
      "debit",
      range
    );
    expect([row.inv, row.pay, row.ret, row.closing]).toEqual([1000, -600, -100, 300]);
  });
  it("a purchase return is not a return on the sales side", () => {
    expect(bucketOf("purchase_return", "debit")).toBe("other");
    expect(bucketOf("sales_return", "debit")).toBe("ret");
  });
});

describe("voided and edited entries", () => {
  const lines = [
    line("2026-11-03", "purchase", 0, 100, { entryId: "a", isReversed: true }),
    line("2026-11-04", "purchase", 100, 0, { entryId: "b", isReversal: true, reversalOfId: "a" }),
    line("2026-11-04", "purchase", 0, 120, { entryId: "c", reference: "FIXED" }),
  ];
  const row = buildPartyRow({ id: "s", name: "X", lines }, "credit", range);
  it("leaves a voided pair out of the list but keeps the totals adding up", () => {
    expect(row.entries.map((e) => e.reference)).toEqual(["FIXED"]);
    expect(row.hiddenPairs).toBe(1);
    expect(row.inv).toBe(120);
    expect(row.entries.at(-1)!.balance).toBe(row.closing);
  });
  it("keeps a reversal whose original is from before the period", () => {
    const split = buildPartyRow({ id: "s", name: "X", lines: [line("2026-10-20", "purchase", 0, 100, { entryId: "a", isReversed: true }), line("2026-11-04", "purchase", 100, 0, { entryId: "b", isReversal: true, reversalOfId: "a" })] }, "credit", range);
    expect(split.opening).toBe(100);
    expect(split.entries).toHaveLength(1);
    expect(split.closing).toBe(0);
  });
});

describe("rows and totals", () => {
  const rows = [
    buildPartyRow({ id: "1", name: "B", lines: [line("2026-11-02", "purchase", 0, 300, { entryId: "x" })] }, "credit", range),
    buildPartyRow({ id: "2", name: "A", lines: [line("2026-11-02", "purchase", 0, 900, { entryId: "y" })] }, "credit", range),
    buildPartyRow({ id: "3", name: "Quiet", lines: [] }, "credit", range),
  ];
  it("marks a party with nothing at either end and no entry as not active", () => {
    expect(rows.map((r) => r.active)).toEqual([true, true, false]);
  });
  it("sorts by name or by what is owed, and adds the totals", () => {
    expect(sortRows(rows, "name").map((r) => r.name)).toEqual(["A", "B", "Quiet"]);
    expect(sortRows(rows, "closing").map((r) => r.name)).toEqual(["A", "B", "Quiet"]);
    expect(totalsOf(rows).closing).toBe(1200);
    expect(entriesTotal(rows[0].entries)).toBe(300);
  });
  it("compares the parties with the ledger's own control account", () => {
    expect(controlCheck(1200, 1200).balanced).toBe(true);
    const off = controlCheck(1250, 1200);
    expect(off.balanced).toBe(false);
    expect(off.difference).toBe(50);
  });
});
