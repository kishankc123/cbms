import { describe, expect, it } from "vitest";
import { calculatePenalty, daysDelayed, type ExcisePenaltyParams, type TdsPenaltyParams, type VatPenaltyParams } from "./penalty-engine";

const VAT: VatPenaltyParams = { filingDailyRate: 0.0005, filingFloor: 1000, latePaymentFlatRate: 0.1, interestAnnualRate: 0.15 };
const TDS: TdsPenaltyParams = { filingFlatPerDay: 100, filingAnnualRate: 0.025, interestAnnualRate: 0.15 };
const EXCISE: ExcisePenaltyParams = { stepUpRatePer30Days: 0.05, stepUpCapRate: 0.25, interestAnnualRate: 0.15, manualOverrideCapRate: 1 };

describe("daysDelayed", () => {
  it("is 0 on time or early, whole days when late", () => {
    expect(daysDelayed("2026-08-25", "2026-08-25")).toBe(0);
    expect(daysDelayed("2026-08-25", "2026-08-20")).toBe(0);
    expect(daysDelayed("2026-08-25", "2026-09-09")).toBe(15);
  });
});

describe("VAT penalty — the three worked scenarios", () => {
  it("Scenario A: Nil return, 10 days late — the floor applies because the calculated fine is 0", () => {
    const r = calculatePenalty("vat", 0, "2026-08-25", "2026-09-04", VAT);
    expect(r.daysDelayed).toBe(10);
    expect(r.filingPenalty).toBe(1000);
  });

  it("Scenario B: small tax payable, short delay — the floor still wins", () => {
    const r = calculatePenalty("vat", 20000, "2026-08-25", "2026-09-09", VAT); // 15 days
    expect(r.daysDelayed).toBe(15);
    expect(r.filingPenalty).toBe(1000); // calculated: 20000*0.0005*15 = 150, floor wins
    expect(r.paymentPenalty).toBe(2000); // 10% of 20,000
    expect(r.interest).toBeCloseTo(123.29, 2); // 20000*0.15*15/365
    expect(r.totalPayable).toBeCloseTo(20000 + 1000 + 2000 + 123.29, 1);
  });

  it("Scenario C: large tax payable, long delay — the calculated fine wins", () => {
    const r = calculatePenalty("vat", 500000, "2026-08-25", "2026-09-24", VAT); // 30 days
    expect(r.daysDelayed).toBe(30);
    expect(r.filingPenalty).toBe(7500); // 500000*0.0005*30 = 7,500 > 1,000 floor
    expect(r.paymentPenalty).toBe(50000);
  });

  it("the mockup's worked example: 150,000 principal, 45 days late", () => {
    const r = calculatePenalty("vat", 150000, "2026-08-25", "2026-10-09", VAT); // 45 days
    expect(r.daysDelayed).toBe(45);
    expect(r.filingPenalty).toBeCloseTo(3375, 0); // 150000*0.0005*45
    expect(r.paymentPenalty).toBe(15000);
    expect(r.interest).toBeCloseTo(2774, 0); // 150000*0.15*45/365
    expect(r.totalPayable).toBeCloseTo(171149, 0);
  });

  it("on time or early: nothing is charged", () => {
    const r = calculatePenalty("vat", 100000, "2026-08-25", "2026-08-20", VAT);
    expect(r.daysDelayed).toBe(0);
    expect(r.filingPenalty).toBe(0);
    expect(r.paymentPenalty).toBe(0);
    expect(r.interest).toBe(0);
    expect(r.totalPayable).toBe(100000);
  });
});

describe("TDS penalty", () => {
  it("combines the flat per-day fine and the annual volume fee, with no separate late-payment penalty", () => {
    const r = calculatePenalty("tds", 100000, "2026-08-25", "2026-09-04", TDS); // 10 days
    expect(r.daysDelayed).toBe(10);
    expect(r.filingPenalty).toBeCloseTo(1000 + 68.49, 1); // 100/day*10 + 100000*0.025*10/365
    expect(r.paymentPenalty).toBe(0);
    expect(r.interest).toBeCloseTo((100000 * 0.15 * 10) / 365, 2);
  });
});

describe("Excise penalty", () => {
  it("steps up every 30-day block, capped at the statutory maximum", () => {
    const r31 = calculatePenalty("excise", 100000, "2026-08-25", "2026-09-25", EXCISE); // 31 days -> 2 blocks
    expect(r31.daysDelayed).toBe(31);
    expect(r31.paymentPenalty).toBe(10000); // 2 blocks x 5% = 10%, under the 25% cap

    const r181 = calculatePenalty("excise", 100000, "2026-08-25", "2027-02-22", EXCISE); // 181 days -> 7 blocks -> 35%, capped
    expect(r181.paymentPenalty).toBe(25000); // capped at 25%
  });

  it("the filing/audit penalty is only ever the manual figure given, capped at the duty amount", () => {
    const capped = calculatePenalty("excise", 100000, "2026-08-25", "2026-09-04", EXCISE, 150000);
    expect(capped.filingPenalty).toBe(100000); // capped at 100% of duty
    const none = calculatePenalty("excise", 100000, "2026-08-25", "2026-09-04", EXCISE);
    expect(none.filingPenalty).toBe(0);
  });
});
