import { describe, expect, it } from "vitest";
import { profileGaps, startDatesOf, type ProfileInput } from "./profile-rules";
import { afterFloor, startFloor } from "./engine/start-dates";

const complete: ProfileInput = {
  entityType: "private_limited",
  panVatNumber: "123456789",
  companyRegistrationDate: "2021-02-02", // 2077/10/20 BS-ish: any date works for the rules
  registrations: [
    { taxTypeKey: "pan", status: "active", effectiveDate: null, filingFrequency: null },
    { taxTypeKey: "vat", status: "active", effectiveDate: "2024-02-02", filingFrequency: "monthly" },
  ],
};

describe("when compliance can start", () => {
  it("needs entity type, PAN/VAT number and the company registration date", () => {
    expect(profileGaps(complete)).toEqual([]);
    expect(profileGaps({ ...complete, entityType: null, panVatNumber: " ", companyRegistrationDate: null }).map((g) => g.key)).toEqual(["entity_type", "pan_vat_number", "registration_date"]);
  });
  it("a VAT registration needs its effective-from date and its filing basis", () => {
    const vat = (over: object) => ({ ...complete, registrations: [{ taxTypeKey: "vat", status: "active", effectiveDate: "2024-02-02", filingFrequency: "monthly", ...over }] });
    expect(profileGaps(vat({ effectiveDate: null })).map((g) => g.key)).toEqual(["vat_effective_from"]);
    expect(profileGaps(vat({ filingFrequency: null })).map((g) => g.key)).toEqual(["vat_filing_basis"]);
    // a VAT registration that is no longer active asks for nothing
    expect(profileGaps(vat({ status: "deregistered", effectiveDate: null, filingFrequency: null }))).toEqual([]);
  });
  it("an excise registration needs the permit date", () => {
    const withExcise = { ...complete, registrations: [...complete.registrations, { taxTypeKey: "excise", status: "active", effectiveDate: null, filingFrequency: null }] };
    expect(profileGaps(withExcise).map((g) => g.key)).toEqual(["excise_permit_date"]);
  });
});

describe("where each kind of item starts", () => {
  const starts = startDatesOf({ ...complete, registrations: [...complete.registrations, { taxTypeKey: "excise", status: "active", effectiveDate: "2022-02-02", filingFrequency: null }] });
  it("VAT starts with the VAT registration, excise with the permit, everything else with the company", () => {
    expect(startFloor("vat", starts)).toBe("2024-02-02");
    expect(startFloor("excise", starts)).toBe("2022-02-02");
    expect(startFloor("income_tax", starts)).toBe("2021-02-02");
    expect(startFloor(null, starts)).toBe("2021-02-02");
    expect(startFloor("tds", starts)).toBe("2021-02-02"); // no TDS registration recorded: from the company
  });
  it("keeps a period that contains the floor, drops one that ended before it", () => {
    expect(afterFloor({ end: "2024-02-15" }, "2024-02-02")).toBe(true);
    expect(afterFloor({ end: "2024-01-31" }, "2024-02-02")).toBe(false);
    expect(afterFloor({ end: "2024-01-31" }, null)).toBe(true);
  });
});
