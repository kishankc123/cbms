import { describe, expect, it } from "vitest";
import { whyNotInRun } from "./run-eligibility";

const P = ["2026-07-17", "2026-08-16"] as const;
const who = (o: Partial<{ employmentStatus: string; joiningDate: string; leavingDate: string | null }>) => ({ employmentStatus: "active", joiningDate: "2025-01-01", leavingDate: null, ...o });

describe("whyNotInRun", () => {
  it("includes an active employee who joined earlier", () => expect(whyNotInRun(who({}), ...P)).toBeNull());
  it("includes someone who joins mid-period", () => expect(whyNotInRun(who({ joiningDate: "2026-08-01" }), ...P)).toBeNull());
  it("leaves out someone who joins after the period", () => expect(whyNotInRun(who({ joiningDate: "2026-08-17" }), ...P)).toMatch(/after this period ends/));
  it("leaves out someone who left before the period", () => expect(whyNotInRun(who({ employmentStatus: "terminated", leavingDate: "2026-07-01" }), ...P)).toMatch(/before this period starts/));
  it("includes someone who left during the period", () => expect(whyNotInRun(who({ employmentStatus: "terminated", leavingDate: "2026-08-01" }), ...P)).toBeNull());
  it("leaves out an inactive employee and says to set them Active", () => expect(whyNotInRun(who({ employmentStatus: "on_leave" }), ...P)).toMatch(/on leave, not Active/));
});
