import { describe, expect, it } from "vitest";
import { nextEmployeeCode } from "./employee-code";

describe("generated employee IDs", () => {
  it("starts at EMP-0001", () => {
    expect(nextEmployeeCode([])).toBe("EMP-0001");
  });
  it("continues after the highest in use, and never reuses a gap", () => {
    expect(nextEmployeeCode(["EMP-0001", "EMP-0002"])).toBe("EMP-0003");
    expect(nextEmployeeCode(["EMP-0001", "EMP-0005"])).toBe("EMP-0006");
  });
  it("ignores IDs of another style typed by hand", () => {
    expect(nextEmployeeCode(["A-17", "007", "EMP-0002"])).toBe("EMP-0003");
    expect(nextEmployeeCode(["A-17"])).toBe("EMP-0001");
  });
  it("grows past four digits", () => {
    expect(nextEmployeeCode(["EMP-9999"])).toBe("EMP-10000");
  });
});
