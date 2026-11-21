import { describe, expect, it } from "vitest";
import { nextOccurrenceFrom } from "./schedule";

const base = { calendar: "AD" as const, intervalMonths: 1, recognitionRule: "last_day" as const, recognitionDay: null, dueRule: "same_day" as const, dueRuleValue: null, endDate: null, stoppedEffectiveDate: null };

describe("nextOccurrenceFrom", () => {
  it("is the first one still to come, not the first one ever", () => {
    const n = nextOccurrenceFrom({ ...base, effectiveFrom: "2026-08-01", fromIso: "2026-11-05" });
    expect(n?.expenseDate).toBe("2026-11-30");
  });
  it("is the first month itself when nothing has passed yet", () => {
    expect(nextOccurrenceFrom({ ...base, effectiveFrom: "2026-12-01", fromIso: "2026-11-05" })?.expenseDate).toBe("2026-12-31");
  });
  it("follows the interval", () => {
    expect(nextOccurrenceFrom({ ...base, intervalMonths: 3, effectiveFrom: "2026-01-01", fromIso: "2026-11-05" })?.expenseDate).toBe("2027-01-31");
  });
  it("is null once past the end or stop date", () => {
    expect(nextOccurrenceFrom({ ...base, effectiveFrom: "2026-08-01", fromIso: "2026-11-05", endDate: "2026-10-31" })).toBeNull();
    expect(nextOccurrenceFrom({ ...base, effectiveFrom: "2026-08-01", fromIso: "2026-11-05", stoppedEffectiveDate: "2026-11-30" })).toBeNull();
  });
});
