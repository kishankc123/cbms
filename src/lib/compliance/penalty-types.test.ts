import { describe, expect, it } from "vitest";
import { fromForm, fromPercent, permitPenalty, summarize, toForm, toPercent, type FormValues } from "./penalty-types";

describe("rates as percentages", () => {
  it("shows a stored fraction as a percentage and back, without float noise", () => {
    expect(toPercent(0.0005)).toBe(0.05);
    expect(toPercent(0.15)).toBe(15);
    expect(fromPercent(0.05)).toBe(0.0005);
    expect(fromPercent(15)).toBe(0.15);
  });
});

describe("the VAT form", () => {
  const vat = { filingDailyRate: 0.0005, filingFloor: 1000, latePaymentFlatRate: 0.1, interestAnnualRate: 0.15, quarterlyFilingFine: 1000 };
  it("round-trips the stored figures", () => {
    const form = toForm("vat", vat);
    expect(form.fields.filingDailyRate).toBe("0.05");
    expect(fromForm("vat", form)).toEqual({ ok: true, params: vat });
  });
  it("leaves out an optional figure that is blank, and refuses a missing or bad one", () => {
    const form = toForm("vat", vat);
    expect(fromForm("vat", { ...form, fields: { ...form.fields, quarterlyFilingFine: "" } })).toEqual({ ok: true, params: { filingDailyRate: 0.0005, filingFloor: 1000, latePaymentFlatRate: 0.1, interestAnnualRate: 0.15 } });
    expect(fromForm("vat", { ...form, fields: { ...form.fields, interestAnnualRate: "" } })).toMatchObject({ ok: false, error: expect.stringMatching(/Enter the interest/) });
    expect(fromForm("vat", { ...form, fields: { ...form.fields, filingFloor: "-5" } })).toMatchObject({ ok: false });
    expect(fromForm("vat", { ...form, fields: { ...form.fields, filingFloor: "abc" } })).toMatchObject({ ok: false });
  });
  it("reads as plain sentences", () => {
    expect(summarize("vat", vat)).toContain("Interest: 15% a year on the unpaid tax");
    expect(summarize("vat", vat)).toContain("Minimum filing fine: Rs 1,000 whatever the daily amount comes to");
  });
});

describe("the excise permit renewal bands", () => {
  const params = { tiers: [{ upToMonths: 3, rate: 0.5, action: "restricted" as const }, { upToMonths: 6, rate: 1, action: "severe" as const }, { upToMonths: null, rate: 2, action: "cancelled" as const }] };
  const form = (): FormValues => toForm("excise_permit", params);

  it("round-trips, and reads as bands", () => {
    expect(fromForm("excise_permit", form())).toEqual({ ok: true, params });
    expect(summarize("excise_permit", params)).toEqual([
      "Up to 3 months late: 50% of the renewal fee. Operations restricted.",
      "3 to 6 months late: 100% of the renewal fee. Severe non-compliance.",
      "More than 6 months late: 200% of the renewal fee. Permit cancelled.",
    ]);
  });
  it("needs bands in increasing order, with no limit on the last one", () => {
    const f = form();
    expect(fromForm("excise_permit", { ...f, tiers: [] })).toMatchObject({ ok: false });
    expect(fromForm("excise_permit", { ...f, tiers: [f.tiers[0], { ...f.tiers[1], upToMonths: "3" }, f.tiers[2]] })).toMatchObject({ ok: false, error: expect.stringMatching(/more than the band before/) });
    expect(fromForm("excise_permit", { ...f, tiers: [f.tiers[0], f.tiers[1], { ...f.tiers[2], upToMonths: "9" }] })).toMatchObject({ ok: false, error: expect.stringMatching(/no upper limit/) });
    expect(fromForm("excise_permit", { ...f, tiers: [{ ...f.tiers[0], ratePercent: "" }, f.tiers[1], f.tiers[2]] })).toMatchObject({ ok: false });
  });
  it("finds the band for a number of months late, and the fine on the company's own fee", () => {
    expect(permitPenalty(params, 0, 10000)).toBeNull();
    expect(permitPenalty(params, 1, 10000)).toMatchObject({ tier: { action: "restricted" }, fine: 5000 });
    expect(permitPenalty(params, 3, 10000)).toMatchObject({ fine: 5000 });
    expect(permitPenalty(params, 4, 10000)).toMatchObject({ tier: { action: "severe" }, fine: 10000 });
    expect(permitPenalty(params, 7, 10000)).toMatchObject({ tier: { action: "cancelled" }, fine: 20000 });
  });
});
