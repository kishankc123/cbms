import { describe, expect, it } from "vitest";
import { permitMessage, permitStatus, shrawanDeadline, type PermitInput } from "./excise-permit-rules";
import type { PermitRenewalParams } from "./penalty-types";

const RULE: PermitRenewalParams = { tiers: [{ upToMonths: 3, rate: 0.5, action: "restricted" }, { upToMonths: 6, rate: 1, action: "severe" }, { upToMonths: null, rate: 2, action: "cancelled" }] };
// Permit issued on 20 Magh 2078 (about 2 Feb 2022), in fiscal year 2078/79.
const base: PermitInput = { today: "2026-10-08", permitDate: "2022-02-03", renewedYears: [], standardFee: 10000, rule: RULE };
const status = (over: Partial<PermitInput>) => permitStatus({ ...base, ...over })!;

describe("the excise permit year", () => {
  it("a permit first issued mid-year is valid until the end of Ashadh, whatever the day", () => {
    const s = status({ today: "2022-03-01" }); // Falgun 2078
    expect(s.state).toBe("active");
    expect(s.coveredThrough).toBe("2078/79");
    expect(s.validUntil).toBe("2022-07-16"); // end of Ashadh 2079
    expect(s.renewalFor).toMatchObject({ label: "2079/80", opens: "2022-07-17" });
  });

  it("is active while the current fiscal year is paid for", () => {
    const s = status({ renewedYears: [2079, 2080, 2081, 2082, 2083] });
    expect(s).toMatchObject({ state: "active", coveredThrough: "2083/84", monthsLate: 0 });
    expect(s.validUntil).toBe("2027-07-16");
  });

  it("enters the renewal window on Shrawan 1 and stays in it to the last day of Shrawan", () => {
    const renewed = [2079, 2080, 2081, 2082];
    expect(status({ renewedYears: renewed, today: "2026-07-16" }).state).toBe("active"); // last day of Ashadh, 2082 still paid for
    expect(status({ renewedYears: renewed, today: "2026-07-17" })).toMatchObject({ state: "renewal_window", unpaidYears: [2083] }); // Shrawan 1
    const deadline = shrawanDeadline(2083);
    expect(status({ renewedYears: renewed, today: deadline }).state).toBe("renewal_window");
  });

  it("is late from the day after Shrawan: Bhadra is month 1, with the first band's fine on the company's own fee", () => {
    const renewed = [2079, 2080, 2081, 2082];
    const s = status({ renewedYears: renewed, today: "2026-08-20" }); // Bhadra 2083
    expect(s).toMatchObject({ state: "expired", monthsLate: 1, penalty: { action: "restricted", rate: 0.5, fine: 5000 }, cancelled: false });
    expect(status({ renewedYears: renewed }).monthsLate).toBe(2); // Ashwin (today in the base input)
  });

  it("follows the bands: months 4 to 6 are 100%, beyond 6 is 200% and cancelled", () => {
    const renewed = [2079, 2080, 2081, 2082];
    expect(status({ renewedYears: renewed, today: "2026-12-10" })).toMatchObject({ monthsLate: 4, penalty: { action: "severe", fine: 10000 } }); // Mangsir 2083
    expect(status({ renewedYears: renewed, today: "2027-01-20" })).toMatchObject({ monthsLate: 6, penalty: { action: "severe" } }); // Magh
    const falgun = status({ renewedYears: renewed, today: "2027-02-25" });
    expect(falgun).toMatchObject({ monthsLate: 7, penalty: { action: "cancelled", fine: 20000 }, cancelled: true });
    expect(permitMessage(falgun)).toMatch(/operating without a licence/);
  });

  it("a permit left unrenewed for years counts from the first unpaid year and lists every year owed", () => {
    const s = status({ renewedYears: [2079] }); // paid through 2079/80, today Ashwin 2083
    expect(s.unpaidYears).toEqual([2080, 2081, 2082, 2083]);
    expect(s.renewalFor.label).toBe("2080/81");
    expect(s.cancelled).toBe(true);
  });

  it("needs the standard fee to put a figure on the fine, and says so", () => {
    const s = status({ renewedYears: [2079, 2080, 2081, 2082], standardFee: null });
    expect(s.penalty).toMatchObject({ action: "restricted", fine: null });
    expect(permitMessage(s)).toMatch(/Enter the standard renewal fee/);
    const noRule = status({ renewedYears: [2079, 2080, 2081, 2082], rule: null });
    expect(noRule.penalty).toBeNull();
    expect(permitMessage(noRule)).toMatch(/confirm the amount/);
  });
});
