import { describe, expect, it } from "vitest";
import { buildCashFlow, bucketOf, classify, defaultGrain, toBuckets, type CashLineGroup } from "./cash-flow-rules";

const g = (day: string, sourceType: string, paymentType: string | null, debit: number, credit: number): CashLineGroup => ({ day, sourceType, paymentType, debit, credit });

describe("which category a cash line is in", () => {
  it("uses the payment's own type when the entry came from a payment", () => {
    expect(classify("receipt", "customer_payment", true)).toBe("customer_collections");
    expect(classify("payment", "supplier_payment", false)).toBe("supplier_payments");
    expect(classify("payment", "salary_payment", false)).toBe("payroll");
    expect(classify("payment", "tax_payment", false)).toBe("tax_payments");
    expect(classify("payment", "loan_repayment", false)).toBe("loan_repayments");
    expect(classify("receipt", "loan_received", true)).toBe("loans_received");
    expect(classify("payment", "owner_withdrawal", false)).toBe("owner_drawings");
  });
  it("falls back to what posted the line when there is no payment record", () => {
    expect(classify("sale", null, true)).toBe("customer_collections");
    expect(classify("receipt", null, true)).toBe("customer_collections");
    expect(classify("purchase", null, false)).toBe("supplier_payments");
    expect(classify("expense", null, false)).toBe("expense_payments");
    expect(classify("payment", null, false)).toBe("expense_payments");
    expect(classify("asset_purchase", null, false)).toBe("asset_purchases");
    expect(classify("asset_disposal", null, true)).toBe("asset_sales");
  });
  it("keeps transfers and opening balances out of money in and out", () => {
    expect(classify("inter_transfer", null, true)).toBe("transfer");
    expect(classify("payment", "bank_transfer", false)).toBe("transfer");
    expect(classify("opening_balance", null, true)).toBe("opening");
  });
  it("shows a manual journal on the side the cash moved", () => {
    expect(classify("manual", null, true)).toBe("adjustments_in");
    expect(classify("manual", null, false)).toBe("adjustments_out");
  });
});

describe("money in, money out and the reconciliation", () => {
  const groups = [
    g("2026-09-01", "opening_balance", null, 10000, 0),
    g("2026-09-02", "receipt", "customer_payment", 5000, 0),
    g("2026-09-02", "sale", null, 1000, 0),
    g("2026-09-03", "payment", "supplier_payment", 0, 2000),
    g("2026-09-03", "expense", null, 0, 500),
    g("2026-09-04", "inter_transfer", null, 3000, 0),
    g("2026-09-04", "inter_transfer", null, 0, 3000),
    g("2026-09-05", "asset_purchase", null, 0, 4000),
    g("2026-09-06", "receipt", "loan_received", 8000, 0),
  ];
  const r = buildCashFlow(groups, 0, 17500, { from: "2026-09-01", to: "2026-09-30" });

  it("adds each side up from its categories", () => {
    expect(r.moneyIn).toBe(14000);
    expect(r.moneyOut).toBe(6500);
    expect(r.netMovement).toBe(7500);
    expect(r.categories.find((c) => c.key === "customer_collections")?.amount).toBe(6000);
  });
  it("sorts them into operating, investing and financing", () => {
    const by = Object.fromEntries(r.activities.map((a) => [a.activity, a]));
    expect(by.operating).toMatchObject({ moneyIn: 6000, moneyOut: 2500, net: 3500 });
    expect(by.investing).toMatchObject({ moneyOut: 4000, net: -4000 });
    expect(by.financing).toMatchObject({ moneyIn: 8000, net: 8000 });
  });
  it("reconciles: opening + movement + transfers + opening entries = closing", () => {
    expect(r.openingEntriesNet).toBe(10000);
    expect(r.transfersNet).toBe(0);
    expect(r.difference).toBe(0);
  });
  it("shows a difference when the ledger's closing cash disagrees", () => {
    expect(buildCashFlow(groups, 0, 17400, { from: "2026-09-01", to: "2026-09-30" }).difference).toBe(-100);
  });
  it("lets a reversal reduce its own category instead of becoming money out", () => {
    const x = buildCashFlow([g("2026-09-02", "receipt", "customer_payment", 5000, 0), g("2026-09-08", "receipt", "customer_payment", 0, 1200)], 0, 3800, { from: "2026-09-01", to: "2026-09-30" });
    expect(x.moneyIn).toBe(3800);
    expect(x.moneyOut).toBe(0);
    expect(x.difference).toBe(0);
  });
});

describe("daily, weekly and monthly buckets", () => {
  it("picks a grain for the length of the period", () => {
    expect(defaultGrain("2026-09-01", "2026-09-30")).toBe("day");
    expect(defaultGrain("2026-07-01", "2026-09-30")).toBe("week");
    expect(defaultGrain("2026-01-01", "2026-12-31")).toBe("month");
  });
  it("starts a week on Sunday", () => {
    expect(bucketOf("2026-09-09", "week", "AD").start).toBe("2026-09-06"); // a Wednesday
    expect(bucketOf("2026-09-06", "week", "AD").start).toBe("2026-09-06"); // the Sunday itself
  });
  it("uses the organization's calendar for months", () => {
    expect(bucketOf("2026-09-09", "month", "AD").label).toBe("Sep 2026");
    // 9 September 2026 is in Bhadra 2083 (BS), the month that started on 17 August
    expect(bucketOf("2026-09-09", "month", "BS").label).toMatch(/2083/);
  });
  it("fills empty buckets and adds the days up", () => {
    const buckets = toBuckets([{ day: "2026-09-02", moneyIn: 100, moneyOut: 0 }, { day: "2026-09-20", moneyIn: 50, moneyOut: 30 }], { from: "2026-09-01", to: "2026-09-30" }, "week", "AD");
    expect(buckets.length).toBeGreaterThanOrEqual(5);
    expect(buckets.reduce((s, b) => s + b.moneyIn, 0)).toBe(150);
    expect(buckets.reduce((s, b) => s + b.moneyOut, 0)).toBe(30);
  });
});
