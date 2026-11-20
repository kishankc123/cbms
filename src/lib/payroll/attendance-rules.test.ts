import { describe, expect, it } from "vitest";
import { dayState, markProblem, monthTotals, NEXT_STATUS } from "./attendance-rules";

const ram = { fullName: "Ram", joiningDate: "2026-11-10", leavingDate: null as string | null };

describe("which days can be marked", () => {
  it("refuses days before joining, after leaving, and days to come", () => {
    expect(dayState(ram, "2026-11-09", "2026-11-20")).toBe("before_joining");
    expect(dayState(ram, "2026-11-10", "2026-11-20")).toBe("open");
    expect(dayState(ram, "2026-11-20", "2026-11-20")).toBe("open");
    expect(dayState(ram, "2026-11-21", "2026-11-20")).toBe("future");
    const gone = { ...ram, leavingDate: "2026-11-15" };
    expect(dayState(gone, "2026-11-16", "2026-11-20")).toBe("after_leaving");
    expect(dayState(gone, "2026-11-15", "2026-11-20")).toBe("open");
  });

  it("says why in plain words", () => {
    expect(markProblem(ram, "2026-11-09", "2026-11-20")).toMatch(/had not joined.*joined 2026-11-10/);
    expect(markProblem(ram, "2026-11-25", "2026-11-20")).toMatch(/hasn't come yet/);
    expect(markProblem(ram, "2026-11-12", "2026-11-20")).toBeNull();
  });

  it("cycles absent, leave, half day, present", () => {
    expect(NEXT_STATUS.present).toBe("absent");
    expect(NEXT_STATUS.absent).toBe("leave");
    expect(NEXT_STATUS.leave).toBe("half_day");
    expect(NEXT_STATUS.half_day).toBe("present");
  });
});

describe("what a month adds up to", () => {
  it("counts unmarked days as present and leaves out holidays, days outside employment and days to come", () => {
    const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-21"];
    const t = monthTotals(ram, dates, { "2026-11-11": "absent", "2026-11-12": "half_day", "2026-11-13": "leave" }, new Set(["2026-11-14"]), "2026-11-20");
    // 9th is before joining, 14th is a holiday, 21st is still to come
    expect(t).toEqual({ present: 1, absent: 1, leave: 1, half: 1 });
  });
});
