import { describe, expect, it } from "vitest";
import { decodeUserMessage, encodeUserMessage, friendlyMessage, isUserFacingError } from "./user-facing-errors";

describe("user-facing errors", () => {
  it("round-trips a message, including non-ASCII characters", () => {
    const m = "Bill number SB-0013998 is already recorded for this supplier — enter a different one";
    expect(decodeUserMessage(encodeUserMessage(m))).toBe(m);
  });

  it("ignores a digest that isn't ours", () => {
    expect(decodeUserMessage("3834523421")).toBeNull();
    expect(decodeUserMessage("NEXT_REDIRECT;replace;/x;307;")).toBeNull();
    expect(decodeUserMessage(undefined)).toBeNull();
  });

  it("shows only plain errors raised by our own code", () => {
    expect(isUserFacingError(new Error("Select a supplier"))).toBe(true);
    expect(isUserFacingError(new TypeError("x is not a function"))).toBe(false);
    expect(isUserFacingError(Object.assign(new Error("duplicate key value"), { code: "23505" }))).toBe(false);
    expect(isUserFacingError(new Error("wrapped", { cause: new Error("inner") }))).toBe(false);
    expect(isUserFacingError(new Error('Failed query: insert into "x" params: secret'))).toBe(false);
    expect(isUserFacingError(new Error("   "))).toBe(false);
    expect(isUserFacingError("a string")).toBe(false);
  });

  it("turns the framework's placeholder into a plain sentence with a reference, and leaves real messages alone", () => {
    const hidden = friendlyMessage("Minified React error #441; visit https://react.dev/errors/441 for the full message", "3834523421");
    expect(hidden).toMatch(/^Something went wrong on our side/);
    expect(hidden).toContain("Reference: 3834523421.");
    expect(hidden).not.toMatch(/React|441/);
    expect(friendlyMessage("An error occurred in the Server Components render. The specific message is omitted in production builds.")).toMatch(/^Something went wrong on our side/);
    expect(friendlyMessage("Select a supplier.")).toBe("Select a supplier.");
    expect(friendlyMessage("Bill number SB-1 is already recorded for this supplier", "ue1:abc")).toBe("Bill number SB-1 is already recorded for this supplier");
    expect(friendlyMessage("Failed to fetch")).toMatch(/could not reach the server/);
    expect(friendlyMessage("Minified React error #441", "ue1:abc")).not.toContain("Reference");
  });

  it("caps a very long message", () => {
    expect(decodeUserMessage(encodeUserMessage("x".repeat(2000)))!.length).toBe(500);
  });
});
