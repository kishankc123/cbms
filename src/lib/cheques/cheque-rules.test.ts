import { describe, expect, it } from "vitest";
import { nextChequeNumber, settlementPreview, summarize, validateCheque, validateClearDate, viewOf, type ChequeInput } from "./cheque-rules";

const today = "2026-11-04";

describe("what state a cheque is in", () => {
  it("separates post-dated, due and stale cheques", () => {
    expect(viewOf({ status: "issued", chequeDate: "2026-11-20" }, today)).toBe("post_dated");
    expect(viewOf({ status: "issued", chequeDate: "2026-11-04" }, today)).toBe("due");
    expect(viewOf({ status: "issued", chequeDate: "2026-06-01" }, today)).toBe("due");
    expect(viewOf({ status: "issued", chequeDate: "2026-04-01" }, today)).toBe("stale");
  });

  it("keeps the state of a finished cheque whatever its date", () => {
    expect(viewOf({ status: "cleared", chequeDate: "2027-01-01" }, today)).toBe("cleared");
    expect(viewOf({ status: "bounced", chequeDate: "2026-01-01" }, today)).toBe("bounced");
    expect(viewOf({ status: "stopped", chequeDate: "2026-01-01" }, today)).toBe("stopped");
  });
});

describe("the next number in the book", () => {
  it("adds one and keeps the length", () => {
    expect(nextChequeNumber(["004510", "004512", "004511"])).toBe("004513");
    expect(nextChequeNumber(["99"])).toBe("100");
    expect(nextChequeNumber(["CHQ-0009"])).toBe("0010");
  });

  it("has nothing to suggest without a numbered cheque", () => {
    expect(nextChequeNumber([])).toBe("");
    expect(nextChequeNumber(["abc"])).toBe("");
  });
});

describe("checking a cheque before it is written down", () => {
  const ok: ChequeInput = { bankAccountId: "b", chequeNumber: "004513", payeeKind: "supplier", vendorId: "v", expenseId: null, amount: 85000, issueDate: "2026-11-04", chequeDate: "2026-12-04", memo: null, replacesId: null };

  it("accepts a good cheque", () => {
    expect(validateCheque(ok, today)).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(validateCheque({ ...ok, chequeNumber: " " }, today)).toBe("Enter the cheque number.");
    expect(validateCheque({ ...ok, vendorId: null }, today)).toBe("Choose the supplier.");
    expect(validateCheque({ ...ok, payeeKind: "expense", expenseId: null }, today)).toBe("Choose the expense this cheque pays.");
    expect(validateCheque({ ...ok, amount: 0 }, today)).toBe("Enter the amount of the cheque.");
    expect(validateCheque({ ...ok, issueDate: "2026-11-10" }, today)).toContain("cannot be in the future");
    expect(validateCheque({ ...ok, chequeDate: "2026-11-01" }, today)).toBe("The cheque date cannot be before the day it was issued.");
    expect(validateCheque({ ...ok, chequeDate: "2028-01-01" }, today)).toContain("more than a year ahead");
  });

  it("only lets a cheque clear on or after its date, and not in the future", () => {
    expect(validateClearDate("2026-11-04", "2026-11-01", today)).toBeNull();
    expect(validateClearDate("2026-11-05", "2026-11-01", today)).toBe("A cheque cannot have cleared on a future date.");
    expect(validateClearDate("2026-10-30", "2026-11-01", today)).toBe("A cheque cannot clear before the date written on it.");
  });
});

describe("what clearing a supplier cheque would settle", () => {
  const bills = [
    { number: "PB-120", date: "2026-10-02", outstanding: 40000 },
    { number: "PB-114", date: "2026-09-25", outstanding: 45000 },
  ];

  it("settles the oldest bills first", () => {
    expect(settlementPreview(bills, 85000)).toEqual({ settles: [{ number: "PB-114", amount: 45000, full: true }, { number: "PB-120", amount: 40000, full: true }], advance: 0 });
  });

  it("part-pays the last bill it reaches", () => {
    const r = settlementPreview(bills, 60000);
    expect(r.settles[1]).toEqual({ number: "PB-120", amount: 15000, full: false });
  });

  it("keeps the excess as an advance", () => {
    expect(settlementPreview(bills, 100000).advance).toBe(15000);
  });
});

describe("the register's figures", () => {
  it("counts only cheques still waiting to clear", () => {
    const s = summarize(
      [
        { status: "issued", chequeDate: "2026-11-04", amount: 1000 },
        { status: "issued", chequeDate: "2026-11-08", amount: 2000 },
        { status: "issued", chequeDate: "2026-12-30", amount: 4000 },
        { status: "issued", chequeDate: "2026-03-01", amount: 8000 },
        { status: "cleared", chequeDate: "2026-11-01", amount: 99999 },
      ],
      today
    );
    expect(s.outstanding).toEqual({ count: 4, amount: 15000 });
    expect(s.dueNow).toEqual({ count: 2, amount: 9000 });
    expect(s.thisWeek.count).toBe(3);
    expect(s.later).toEqual({ count: 1, amount: 4000 });
    expect(s.stale).toEqual({ count: 1, amount: 8000 });
  });
});
