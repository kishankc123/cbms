import { describe, expect, it } from "vitest";
import { attentionItems, type AttentionInput } from "./overview-rules";

const clean: AttentionInput = { activeEmployees: 5, missingPan: 0, missingBank: 0, enrolledWithoutRegistration: 0, slabsPublished: true, rulesPublished: true, rulesVerified: true, anyEnrolled: true };

describe("payroll overview attention items", () => {
  it("is empty when there is nothing to flag", () => {
    expect(attentionItems(clean)).toEqual([]);
  });

  it("flags missing slabs and missing rules as problems, but rules only when someone is enrolled", () => {
    expect(attentionItems({ ...clean, slabsPublished: false }).map((i) => [i.key, i.tone])).toEqual([["slabs", "danger"]]);
    expect(attentionItems({ ...clean, rulesPublished: false }).map((i) => i.key)).toEqual(["rules"]);
    expect(attentionItems({ ...clean, rulesPublished: false, anyEnrolled: false })).toEqual([]);
  });

  it("says unverified rules are a warning, and only matters when someone is enrolled", () => {
    expect(attentionItems({ ...clean, rulesVerified: false }).map((i) => [i.key, i.tone])).toEqual([["unverified", "warning"]]);
    expect(attentionItems({ ...clean, rulesVerified: false, anyEnrolled: false })).toEqual([]);
  });

  it("counts people with a missing PAN, bank account or registration number in plain words", () => {
    const items = attentionItems({ ...clean, missingPan: 1, missingBank: 3, enrolledWithoutRegistration: 2 });
    expect(items.map((i) => i.text)).toEqual([
      "1 active employee has no PAN recorded.",
      "3 active employees have no bank account recorded.",
      "2 retirement enrolments have no registration number. SSF is not worked out without one.",
    ]);
  });
});
