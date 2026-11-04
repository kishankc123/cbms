import { describe, expect, it } from "vitest";
import { buildForecast } from "./forecast-rules";
import { eventFlows, paymentFlows, positionOf, rollForward, safestDate, salesFlows, salesNeeded, type EventDraft } from "./planning-rules";

const today = "2026-11-03";
const draft = (p: Partial<EventDraft> = {}): EventDraft => ({ estimate: 12000, high: null, plannedDate: "2026-11-10", pattern: "full", advancePct: null, balanceDays: null, instalments: null, intervalDays: null, creditDays: null, salesEffect: "none", salesEffectMonthly: null, salesEffectDays: null, ...p });
const sum = (f: { amount: number }[]) => f.reduce((s, x) => s + x.amount, 0);

describe("payment patterns", () => {
  it("pays in full on the date", () => {
    expect(paymentFlows(draft())).toEqual([{ date: "2026-11-10", amount: -12000 }]);
  });

  it("splits an advance and a balance", () => {
    expect(paymentFlows(draft({ pattern: "advance_balance", advancePct: 25, balanceDays: 20 }))).toEqual([
      { date: "2026-11-10", amount: -3000 },
      { date: "2026-11-30", amount: -9000 },
    ]);
  });

  it("spreads instalments and keeps the total exact", () => {
    const f = paymentFlows(draft({ estimate: 10000, pattern: "instalments", instalments: 3, intervalDays: 30 }));
    expect(f.map((x) => x.date)).toEqual(["2026-11-10", "2026-12-10", "2027-01-09"]);
    expect(sum(f)).toBe(-10000);
  });

  it("pays later on credit", () => {
    expect(paymentFlows(draft({ pattern: "credit", creditDays: 45 }))).toEqual([{ date: "2026-12-25", amount: -12000 }]);
  });

  it("tries the high end when asked", () => {
    expect(sum(paymentFlows(draft({ high: 15000 }), "high"))).toBe(-15000);
    expect(sum(paymentFlows(draft({ high: null }), "high"))).toBe(-12000);
  });
});

describe("effect on sales", () => {
  it("adds cash after a raise and removes it during an interruption", () => {
    const raise = salesFlows(draft({ salesEffect: "raise", salesEffectMonthly: 3000, salesEffectDays: 30 }));
    expect(raise[0].date).toBe("2026-11-11");
    expect(sum(raise)).toBe(3000);
    const stop = salesFlows(draft({ salesEffect: "interrupt", salesEffectMonthly: 3000, salesEffectDays: 10 }));
    expect(stop[0].date).toBe("2026-11-10");
    expect(sum(stop)).toBe(-1000);
    expect(salesFlows(draft())).toEqual([]);
  });
});

describe("trying an event against the forecast", () => {
  const base = buildForecast({ today, horizonDays: 30, openingCash: 20000, reserve: 5000, events: [] });

  it("rolls the balance forward with the event", () => {
    const days = rollForward(20000, base.days, eventFlows(draft()));
    expect(days[7].balance).toBe(8000);
    expect(days[30].balance).toBe(8000);
  });

  it("finds the lowest point, the reserve breach and the headroom", () => {
    const p = positionOf(rollForward(20000, base.days, eventFlows(draft())), 10000);
    expect(p.lowest).toEqual({ date: "2026-11-10", balance: 8000 });
    expect(p.breachDate).toBe("2026-11-10");
    expect(p.shortfallDate).toBeNull();
    expect(p.headroom).toBe(-2000);
  });

  it("picks the date that leaves the most cash at the lowest point", () => {
    // Money comes in on 20 Nov, so waiting for it keeps the balance higher at its lowest.
    const withIncome = buildForecast({ today, horizonDays: 30, openingCash: 5000, reserve: 0, events: [{ id: "i", category: "collections", side: "in", date: "2026-11-20", amount: 30000, party: "x", basis: "due_date", certainty: "confirmed" }] });
    const waits = safestDate(5000, withIncome.days, [], draft({ estimate: 4000 }), { earliest: "2026-11-05", latest: "2026-11-25" }, 0);
    expect(waits?.date).toBe("2026-11-20");
    expect(waits?.position.lowest.balance).toBe(5000);
  });

  it("takes the earliest date when every date is as safe", () => {
    const quiet = buildForecast({ today, horizonDays: 30, openingCash: 5000, reserve: 0, events: [] });
    const best = safestDate(5000, quiet.days, [], draft({ estimate: 1000 }), { earliest: "2026-11-05", latest: "2026-11-25" }, 0);
    expect(best?.date).toBe("2026-11-05");
    expect(best?.position.lowest.balance).toBe(4000);
  });

  it("returns nothing when the window is outside the forecast", () => {
    expect(safestDate(5000, base.days, [], draft(), { earliest: "2027-06-01", latest: null }, 0)).toBeNull();
  });
});

describe("sales needed", () => {
  it("divides the shortfall by what each rupee of sales brings", () => {
    expect(salesNeeded(30000, 0.9, 0.5)).toEqual({ shortfall: 30000, netPerRupee: 0.4, salesNeeded: 75000, note: null });
  });

  it("needs nothing when there is no shortfall", () => {
    expect(salesNeeded(-5, 0.9, 0.5).salesNeeded).toBe(0);
  });

  it("says so when more sales cannot help", () => {
    const n = salesNeeded(30000, 0.6, 0.6);
    expect(n.salesNeeded).toBeNull();
    expect(n.note).toContain("does not add cash");
  });
});

import { validateEvent, type EventInput } from "./planning-rules";

describe("checking an event", () => {
  const ok: EventInput = { name: "New fridge", category: "asset", vendorId: null, estimate: 50000, low: 45000, high: 60000, earliestDate: "2026-11-10", latestDate: "2026-12-10", plannedDate: "2026-11-20", pattern: "full", advancePct: null, balanceDays: null, instalments: null, intervalDays: null, creditDays: null, urgency: "should_do_soon", salesEffect: "none", salesEffectMonthly: null, salesEffectDays: null, notes: null };

  it("accepts a good event", () => {
    expect(validateEvent(ok)).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(validateEvent({ ...ok, name: " " })).toBe("Give the event a name.");
    expect(validateEvent({ ...ok, estimate: 0 })).toBe("Enter the estimated amount.");
    expect(validateEvent({ ...ok, high: 40000 })).toBe("The high end cannot be less than the estimate.");
    expect(validateEvent({ ...ok, plannedDate: "2026-12-20" })).toBe("The chosen date must fall between the earliest and latest dates.");
    expect(validateEvent({ ...ok, salesEffect: "raise" })).toBe("Enter how much sales would change by in a month.");
    expect(validateEvent({ ...ok, salesEffect: "raise", salesEffectMonthly: 5000, salesEffectDays: 60 })).toBeNull();
  });
});
