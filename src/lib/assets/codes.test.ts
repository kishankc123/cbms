import { describe, expect, it } from "vitest";
import { buildAssetCode, nextAssetSequence } from "./codes";

describe("asset codes", () => {
  it("pads the sequence to six digits", () => {
    expect(buildAssetCode("FA-", 1)).toBe("FA-000001");
    expect(buildAssetCode("FA-", 123456)).toBe("FA-123456");
  });

  it("continues after the highest number with this prefix, ignoring other prefixes and non-numeric tails", () => {
    expect(nextAssetSequence("FA-", [])).toBe(1);
    expect(nextAssetSequence("FA-", ["FA-000001", "FA-000010", "FA-000003"])).toBe(11);
    expect(nextAssetSequence("FA-", ["XX-000099", "FA-OLD", "FA-000002"])).toBe(3);
  });
});
