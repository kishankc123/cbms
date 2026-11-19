import { describe, expect, it } from "vitest";
import { bridge, detectOrientation, effectOf, matchLedgers, proof, refsAgree, statementBalances, type Line } from "./reconcile-rules";

const L = (id: string, date: string, reference: string, effect: number): Line => ({ id, date, reference, description: "", effect });
const tol = { dateDays: 7, amount: 1 };

describe("reading the statement", () => {
  it("credit minus debit is the effect when a credit is a bill, and the opposite when the statement is the supplier's own book", () => {
    expect(effectOf(1000, "credit_is_bill")).toBe(1000);
    expect(effectOf(-400, "credit_is_bill")).toBe(-400);
    expect(effectOf(1000, "debit_is_bill")).toBe(-1000);
  });

  it("finds the orientation from the running balance", () => {
    const usual = [{ amount: 1000, balance: 1000 }, { amount: -400, balance: 600 }, { amount: 250, balance: 850 }];
    expect(detectOrientation(usual)).toBe("credit_is_bill");
    // their own book: a debit (negative here) raises the balance
    const theirs = [{ amount: -1000, balance: 1000 }, { amount: 400, balance: 600 }, { amount: -250, balance: 850 }];
    expect(detectOrientation(theirs)).toBe("debit_is_bill");
    expect(detectOrientation([{ amount: 5, balance: null }])).toBe("credit_is_bill");
  });

  it("takes the opening and closing balance from the balance column, or builds them from the rows", () => {
    expect(statementBalances([{ amount: 1000, balance: 3000 }, { amount: -400, balance: 2600 }], "credit_is_bill")).toEqual({ opening: 2000, closing: 2600 });
    expect(statementBalances([{ amount: 1000, balance: null }, { amount: -400, balance: null }], "credit_is_bill")).toEqual({ opening: 0, closing: 600 });
  });
});

describe("matching the two sides", () => {
  it("document numbers must be long enough to mean something", () => {
    expect(refsAgree("INV-1042", "inv1042")).toBe(true);
    expect(refsAgree("INV-1042", "1042")).toBe(true);
    expect(refsAgree("B-1", "B-1")).toBe(false);
  });

  it("the same document number and amount is matched without anyone's OK; other evidence is only suggested", () => {
    const theirs = [L("t1", "2083-04-03", "INV-1042", 125000), L("t2", "2083-04-11", "RCT-0311", -50000), L("t3", "2083-05-20", "X", -7000)];
    const ours = [L("o1", "2083-04-04", "INV-1042", 125000), L("o2", "2083-04-12", "", -50000), L("o3", "2083-05-25", "", -7000)];
    const r = matchLedgers(theirs, ours, tol);
    expect(r.groups).toContainEqual({ kind: "reference", auto: true, theirIds: ["t1"], ourIds: ["o1"] });
    expect(r.groups).toContainEqual({ kind: "amount_date", auto: false, theirIds: ["t2"], ourIds: ["o2"] });
    expect(r.groups).toContainEqual({ kind: "amount_date", auto: false, theirIds: ["t3"], ourIds: ["o3"] });
    expect(r.theirsOnly).toEqual([]);
    expect(r.oursOnly).toEqual([]);
  });

  it("the same document number with a different amount is suggested, with the amounts left to differ", () => {
    const r = matchLedgers([L("t1", "2083-04-03", "INV-1052", 112000)], [L("o1", "2083-04-03", "INV-1052", 111000)], tol);
    expect(r.groups).toEqual([{ kind: "reference_diff", auto: false, theirIds: ["t1"], ourIds: ["o1"] }]);
  });

  it("an amount outside the date window, or on the other side, is not matched", () => {
    const r = matchLedgers([L("t1", "2083-04-03", "", 500), L("t2", "2083-04-03", "", -500)], [L("o1", "2083-05-30", "", 500), L("o2", "2083-04-03", "", 500)], tol);
    expect(r.groups).toEqual([{ kind: "amount_date", auto: false, theirIds: ["t1"], ourIds: ["o2"] }]);
    expect(r.theirsOnly).toEqual(["t2"]);
    expect(r.oursOnly).toEqual(["o1"]);
  });

  it("one receipt covering several of our payments is found as a combination, in either direction", () => {
    const a = matchLedgers([L("t1", "2083-04-10", "", -30000)], [L("o1", "2083-04-08", "", -10000), L("o2", "2083-04-09", "", -20000)], tol);
    expect(a.groups).toEqual([{ kind: "combination", auto: false, theirIds: ["t1"], ourIds: ["o1", "o2"] }]);
    const b = matchLedgers([L("t1", "2083-04-08", "", 10000), L("t2", "2083-04-09", "", 20000)], [L("o1", "2083-04-10", "", 30000)], tol);
    expect(b.groups).toEqual([{ kind: "combination", auto: false, theirIds: ["t1", "t2"], ourIds: ["o1"] }]);
  });

  it("a line is used once", () => {
    const r = matchLedgers([L("t1", "2083-04-03", "", 100), L("t2", "2083-04-03", "", 100)], [L("o1", "2083-04-03", "", 100)], tol);
    expect(r.groups).toHaveLength(1);
    expect(r.theirsOnly).toHaveLength(1);
  });
});

describe("what the difference is made of", () => {
  it("the parts add up to the difference, and the bridge ends on their balance", () => {
    const theirs = [L("t1", "d", "A", 1000), L("t2", "d", "B", -300), L("t3", "d", "C", 400)];
    const ours = [L("o1", "d", "A", 1000), L("o2", "d", "B", -250), L("o3", "d", "D", -100)];
    const { groups } = matchLedgers(theirs, ours, { dateDays: 7, amount: 0 });
    const ourOpening = 500;
    const theirOpening = 450;
    const ourClosing = ourOpening + 1000 - 250 - 100;
    const theirClosing = theirOpening + 1000 - 300 + 400;
    const p = proof({ ourOpening, ourClosing, theirOpening, theirClosing, theirs, ours, groups });
    expect(p.difference).toBe(ourClosing - theirClosing);
    expect(p.openingDifference + p.matchedDifference + p.oursOnly - p.theirsOnly).toBeCloseTo(p.difference, 2);
    const rows = bridge(ourClosing, p);
    expect(rows[rows.length - 1]).toEqual({ label: "Balance on their statement", amount: theirClosing });
  });
});
