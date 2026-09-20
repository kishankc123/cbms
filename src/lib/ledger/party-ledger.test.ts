import { describe, it, expect } from "vitest";
import { buildStatement, describeLine, partyBuckets, type PartyLine } from "./party-statement";

const L = (o: Partial<PartyLine>): PartyLine => ({ date: "2026-09-01", debit: 0, credit: 0, sourceType: "manual", reference: null, memo: null, isReversal: false, ...o });

// A supplier (credit-normal): opening 45,000 owed, a 30,000 bill, 10,000 paid, and a manual voucher crediting 5,000.
const supplier: PartyLine[] = [
  L({ sourceType: "opening_balance", credit: 45000, date: "2026-07-17" }),
  L({ sourceType: "purchase", credit: 30000, date: "2026-08-10", reference: "B-1" }),
  L({ sourceType: "payment", debit: 10000, date: "2026-08-20" }),
  L({ sourceType: "manual", credit: 5000, date: "2026-09-20", reference: "JV-0001", memo: "Promotion" }),
];

describe("party ledger", () => {
  it("a manual voucher on the party's account is part of their balance", () => {
    const s = buildStatement(supplier, "credit");
    expect(s.closingBalance).toBe(70000); // 45,000 + 30,000 - 10,000 + 5,000
    expect(s.rows.map((r) => r.details)).toEqual(["Purchase bill B-1", "Payment made", "Journal voucher JV-0001 — Promotion"]);
    expect(s.rows.map((r) => r.balance)).toEqual([75000, 65000, 70000]);
  });

  it("the opening-balance entry is the opening, whatever its date", () => {
    const s = buildStatement(supplier, "credit", { from: "2026-08-15", to: "2026-09-30" });
    // opening = 45,000 (opening entry) + 30,000 (bill before the range)
    expect(s.openingBalance).toBe(75000);
    expect(s.rows).toHaveLength(2);
    expect(s.closingBalance).toBe(70000);
  });

  it("signs a customer (debit-normal) the other way round", () => {
    const customer: PartyLine[] = [L({ sourceType: "opening_balance", debit: 1000 }), L({ sourceType: "sale", debit: 500, reference: "INV-1" }), L({ sourceType: "receipt", credit: 300 })];
    const s = buildStatement(customer, "debit");
    expect(s.closingBalance).toBe(1200);
    expect(s.rows.map((r) => r.details)).toEqual(["Sales invoice INV-1", "Payment received"]);
  });

  it("splits lines into the buckets the screens show", () => {
    const b = partyBuckets(supplier, "credit");
    expect(b.opening).toBe(45000);
    expect(b.invoices).toEqual([{ date: "2026-08-10", total: 30000 }]);
    expect(b.payments).toEqual([{ date: "2026-08-20", amount: 10000 }]);
    expect(b.others).toEqual([{ date: "2026-09-20", amount: 5000 }]);
    const total = b.opening + b.invoices[0].total - b.payments[0].amount + b.others[0].amount;
    expect(total).toBe(buildStatement(supplier, "credit").closingBalance);
  });

  it("shows a reversal as a reversal, and it cancels the original", () => {
    const lines = [L({ sourceType: "purchase", credit: 100, reference: "B-9" }), L({ sourceType: "purchase", debit: 100, reference: "B-9", isReversal: true })];
    const s = buildStatement(lines, "credit");
    expect(s.closingBalance).toBe(0);
    expect(s.rows[1].details).toBe("Reversal — Purchase bill B-9");
    expect(describeLine(L({ sourceType: "bank_adjustment", memo: "Bank charge" }))).toBe("Bank charge");
  });
});
