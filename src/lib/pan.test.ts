import { describe, it, expect } from "vitest";
import { normalizePan, optionalPan, optionalPanError, panError, requirePan } from "./pan";

describe("PAN validation", () => {
  it("accepts exactly nine digits", () => {
    expect(panError("123456789")).toBeNull();
    expect(panError(" 123 456 789 ")).toBeNull();
    expect(requirePan("623525469")).toBe("623525469");
  });

  it("is compulsory", () => {
    expect(panError("")).toBe("PAN is required");
    expect(panError(null)).toBe("PAN is required");
    expect(panError("   ", "PAN / VAT number")).toBe("PAN / VAT number is required");
  });

  it("rejects anything that is not nine digits", () => {
    expect(panError("12345678")).toMatch(/exactly 9 digits/);
    expect(panError("1234567890")).toMatch(/exactly 9 digits/);
    expect(panError("12345678A")).toMatch(/exactly 9 digits/);
    expect(panError("123-456-789")).toMatch(/exactly 9 digits/);
    expect(() => requirePan("abc")).toThrow(/exactly 9 digits/);
  });

  it("accepts Nepali digits and stores them as 0-9", () => {
    expect(normalizePan("१२३४५६७८९")).toBe("123456789");
    expect(panError("१२३४५६७८९")).toBeNull();
  });
});

describe("an optional PAN (customers and suppliers)", () => {
  it("may be left blank", () => {
    expect(optionalPanError("")).toBeNull();
    expect(optionalPanError(null)).toBeNull();
    expect(optionalPanError("   ")).toBeNull();
    expect(optionalPan("")).toBe("");
  });
  it("is still checked when something is typed", () => {
    expect(optionalPanError("123456789")).toBeNull();
    expect(optionalPan(" 123 456 789 ")).toBe("123456789");
    expect(optionalPanError("12345")).toMatch(/exactly 9 digits/);
    expect(() => optionalPan("abc")).toThrow(/exactly 9 digits/);
  });
});
