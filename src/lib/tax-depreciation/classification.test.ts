import { describe, expect, it } from "vitest";
import { defaultNepalClass } from "./classification";

describe("default Nepal class for the standard asset categories", () => {
  const key = (n: string) => defaultNepalClass(n).poolKey;
  it("follows the agreed classification", () => {
    expect(key("Land")).toBeNull();
    expect(key("Building")).toBe("A");
    expect(key("Computer & IT Equipment")).toBe("B");
    expect(key("Furniture & Fixtures")).toBe("B");
    expect(key("Office Equipment")).toBe("B");
    expect(key("Vehicle")).toBe("C");
    expect(key("Machinery")).toBe("D");
    expect(key("Plant & Equipment")).toBe("D");
    expect(key("Construction Equipment")).toBe("D");
    expect(key("Intangible Assets")).toBe("E");
  });
  it("sends anything it can't place to Class D for a person to review", () => {
    expect(defaultNepalClass("Other Fixed Assets")).toMatchObject({ poolKey: "D", needsReview: true });
    expect(defaultNepalClass("Vehicle").needsReview).toBe(false);
  });
});
