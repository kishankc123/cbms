import { describe, expect, it } from "vitest";
import { mobileError, userAccountProblem } from "./user-account-rules";

const ok = { fullName: "Sita Rai", email: "sita@example.com", mobile: "98-41234567", password: "Secret123", confirmPassword: "Secret123" };

describe("contact numbers", () => {
  it("is optional, and otherwise digits with an optional leading +", () => {
    expect(mobileError("")).toBeNull();
    expect(mobileError(undefined)).toBeNull();
    expect(mobileError("+977 9841234567")).toBeNull();
    expect(mobileError("98-41234567")).toBeNull();
    expect(mobileError("98x41234567")).toMatch(/digits only/);
    expect(mobileError("12345")).toMatch(/between 7 and 15/);
    expect(mobileError("1".repeat(16))).toMatch(/between 7 and 15/);
  });
});

describe("account details", () => {
  it("accepts sound details", () => {
    expect(userAccountProblem(ok)).toBeNull();
    expect(userAccountProblem({ ...ok, mobile: "" })).toBeNull();
  });

  it("reports the first problem in the order the form asks", () => {
    expect(userAccountProblem({ ...ok, fullName: " " })).toMatch(/Full name/);
    expect(userAccountProblem({ ...ok, email: "not-an-email" })).toMatch(/valid email/);
    expect(userAccountProblem({ ...ok, mobile: "abc" })).toMatch(/contact number/);
    expect(userAccountProblem({ ...ok, confirmPassword: "Other123" })).toMatch(/do not match/);
    expect(userAccountProblem({ ...ok, password: "short1", confirmPassword: "short1" })).toMatch(/at least 8/);
    expect(userAccountProblem({ ...ok, password: "lettersonly", confirmPassword: "lettersonly" })).toMatch(/letter and one number/);
  });
});
