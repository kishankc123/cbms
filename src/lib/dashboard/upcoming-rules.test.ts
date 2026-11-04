import { describe, expect, it } from "vitest";
import { bucketOf, dueLabel, emptyTotals, soonLimit, totalOf } from "./upcoming-rules";

describe("upcoming money rules", () => {
  const today = "2026-11-03";

  it("puts a due date into the right bucket", () => {
    expect(bucketOf("2026-11-02", today)).toBe("overdue");
    expect(bucketOf("2026-11-03", today)).toBe("today");
    expect(bucketOf("2026-11-04", today)).toBe("soon");
    expect(bucketOf("2026-11-10", today)).toBe("soon");
    expect(bucketOf("2026-11-11", today)).toBe("scheduled");
  });

  it("gives the last day counted as soon", () => {
    expect(soonLimit(today)).toBe("2026-11-10");
    expect(soonLimit("2026-12-28")).toBe("2027-01-04");
  });

  it("words the timing plainly", () => {
    expect(dueLabel("2026-11-03", today)).toBe("Due today");
    expect(dueLabel("2026-11-04", today)).toBe("Tomorrow");
    expect(dueLabel("2026-11-02", today)).toBe("1 day overdue");
    expect(dueLabel("2026-10-24", today)).toBe("10 days overdue");
    expect(dueLabel("2026-11-08", today)).toBe("In 5 days");
  });

  it("adds up chosen buckets", () => {
    const t = emptyTotals();
    t.overdue = { count: 2, amount: 100.1 };
    t.soon = { count: 1, amount: 50.2 };
    t.scheduled = { count: 3, amount: 10 };
    expect(totalOf(t)).toEqual({ count: 6, amount: 160.3 });
    expect(totalOf(t, ["overdue", "today"])).toEqual({ count: 2, amount: 100.1 });
  });
});
