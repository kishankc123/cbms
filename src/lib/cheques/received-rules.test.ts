import { describe, expect, it } from "vitest";
import { receivedViewOf, summarizeReceived, validateDeposit, validateReceived, validateReceivedClear, type ReceivedInput } from "./received-rules";

const today = "2026-11-04";

describe("what state a received cheque is in", () => {
  it("separates post-dated, ready, deposited and stale cheques", () => {
    expect(receivedViewOf({ status: "received", chequeDate: "2026-11-20" }, today)).toBe("post_dated");
    expect(receivedViewOf({ status: "received", chequeDate: "2026-11-04" }, today)).toBe("ready");
    expect(receivedViewOf({ status: "received", chequeDate: "2026-04-01" }, today)).toBe("stale");
    expect(receivedViewOf({ status: "deposited", chequeDate: "2026-11-01" }, today)).toBe("deposited");
  });

  it("keeps the state of a finished cheque", () => {
    expect(receivedViewOf({ status: "cleared", chequeDate: "2027-01-01" }, today)).toBe("cleared");
    expect(receivedViewOf({ status: "bounced", chequeDate: "2026-01-01" }, today)).toBe("bounced");
    expect(receivedViewOf({ status: "returned", chequeDate: "2026-01-01" }, today)).toBe("returned");
  });
});

describe("recording a received cheque", () => {
  const ok: ReceivedInput = { customerId: "c", drawerBank: "Nabil Bank", chequeNumber: "778899", amount: 45000, receivedDate: "2026-11-04", chequeDate: "2026-12-10", memo: null };

  it("accepts a good cheque", () => {
    expect(validateReceived(ok, today)).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(validateReceived({ ...ok, customerId: "" }, today)).toBe("Choose the customer who gave the cheque.");
    expect(validateReceived({ ...ok, drawerBank: " " }, today)).toBe("Enter the bank the cheque is drawn on.");
    expect(validateReceived({ ...ok, chequeNumber: "" }, today)).toBe("Enter the cheque number.");
    expect(validateReceived({ ...ok, amount: -1 }, today)).toBe("Enter the amount of the cheque.");
    expect(validateReceived({ ...ok, receivedDate: "2026-11-09" }, today)).toBe("The date received cannot be in the future.");
    expect(validateReceived({ ...ok, chequeDate: "2025-01-01" }, today)).toContain("already stale");
  });
});

describe("depositing and clearing", () => {
  const c = { chequeDate: "2026-11-01", receivedDate: "2026-10-20" };

  it("deposits on or after the cheque date, and not in the future", () => {
    expect(validateDeposit("2026-11-02", c, today)).toBeNull();
    expect(validateDeposit("2026-10-30", c, today)).toBe("A cheque cannot be deposited before the date written on it.");
    expect(validateDeposit("2026-11-05", c, today)).toBe("A cheque cannot have been deposited on a future date.");
  });

  it("clears on or after the deposit", () => {
    expect(validateReceivedClear("2026-11-03", { chequeDate: "2026-11-01", depositedDate: "2026-11-02" }, today)).toBeNull();
    expect(validateReceivedClear("2026-11-01", { chequeDate: "2026-11-01", depositedDate: "2026-11-02" }, today)).toBe("A cheque cannot clear before it was deposited.");
    expect(validateReceivedClear("2026-10-30", { chequeDate: "2026-11-01", depositedDate: null }, today)).toBe("A cheque cannot clear before the date written on it.");
  });
});

describe("the register's figures", () => {
  it("counts only cheques still waiting to clear", () => {
    const s = summarizeReceived(
      [
        { status: "received", chequeDate: "2026-11-04", amount: 1000 },
        { status: "received", chequeDate: "2026-12-30", amount: 4000 },
        { status: "deposited", chequeDate: "2026-11-01", amount: 2000 },
        { status: "received", chequeDate: "2026-03-01", amount: 8000 },
        { status: "cleared", chequeDate: "2026-11-01", amount: 99999 },
      ],
      today
    );
    expect(s.waiting).toEqual({ count: 4, amount: 15000 });
    expect(s.readyToDeposit).toEqual({ count: 1, amount: 1000 });
    expect(s.postDated).toEqual({ count: 1, amount: 4000 });
    expect(s.deposited).toEqual({ count: 1, amount: 2000 });
    expect(s.stale).toEqual({ count: 1, amount: 8000 });
  });
});
