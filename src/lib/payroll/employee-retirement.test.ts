import { describe, expect, it } from "vitest";
import { checkEnrolment, enrolmentsOn, enrolmentWarnings, type Enrolment } from "./employee-retirement";
import { NEPAL_DEFAULT_RULES } from "./retirement-rules";

const e = (over: Partial<Enrolment>): Enrolment => ({ scheme: "ssf", registrationNumber: "S-1", startDate: "2026-07-17", endDate: null, citMode: null, citValue: null, citEmployerValue: null, ...over });
const emp = { joiningDate: "2026-01-01", leavingDate: null };

describe("enrolling an employee", () => {
  it("needs a start date, and an SSF registration number", () => {
    expect(checkEnrolment(e({ startDate: "" }), [], emp)).toMatch(/start/);
    expect(checkEnrolment(e({ registrationNumber: " " }), [], emp)).toMatch(/registration/);
    expect(checkEnrolment(e({ scheme: "pf", registrationNumber: null }), [], emp)).toBeNull();
  });

  it("is not allowed before joining, or with an end before the start", () => {
    expect(checkEnrolment(e({ startDate: "2025-12-31" }), [], emp)).toMatch(/joined/);
    expect(checkEnrolment(e({ endDate: "2026-07-01" }), [], emp)).toMatch(/end date/);
  });

  it("keeps SSF and PF apart, and one scheme from overlapping itself", () => {
    const ssf = e({ id: "1", startDate: "2026-07-17", endDate: null });
    expect(checkEnrolment(e({ scheme: "pf", startDate: "2026-09-01" }), [ssf], emp)).toMatch(/SSF and PF/);
    expect(checkEnrolment(e({ startDate: "2026-09-01" }), [ssf], emp)).toMatch(/already recorded/);
    // after SSF has ended, PF may start (changing scheme)
    expect(checkEnrolment(e({ scheme: "pf", startDate: "2026-10-01" }), [{ ...ssf, endDate: "2026-09-30" }], emp)).toBeNull();
  });

  it("lets CIT sit beside SSF or PF, and needs the employee's own choice", () => {
    const ssf = e({ id: "1" });
    expect(checkEnrolment(e({ scheme: "cit", registrationNumber: null, citMode: "fixed", citValue: 2000 }), [ssf], emp)).toBeNull();
    expect(checkEnrolment(e({ scheme: "cit", citMode: null }), [ssf], emp)).toMatch(/fixed amount or a percentage/);
    expect(checkEnrolment(e({ scheme: "cit", citMode: "percent", citValue: 150 }), [ssf], emp)).toMatch(/100/);
    expect(checkEnrolment(e({ scheme: "cit", citMode: "fixed", citValue: 0 }), [ssf], emp)).toMatch(/chosen/);
  });

  it("finds what is in force on a date", () => {
    const rows = [e({ id: "1", endDate: "2026-09-30" }), e({ id: "2", scheme: "pf", startDate: "2026-10-01" })];
    expect(enrolmentsOn(rows, "2026-08-15").map((r) => r.id)).toEqual(["1"]);
    expect(enrolmentsOn(rows, "2026-10-15").map((r) => r.id)).toEqual(["2"]);
    expect(enrolmentsOn(rows, "2026-01-15")).toEqual([]);
  });
});

describe("warnings", () => {
  const person = { employmentType: "intern", leavingDate: null, panNumber: null, sstEligible: false };
  const rules = { ...NEPAL_DEFAULT_RULES, schemes: { ...NEPAL_DEFAULT_RULES.schemes, ssf: { ...NEPAL_DEFAULT_RULES.schemes.ssf, eligibleEmploymentTypes: ["full_time"] } } };
  it("flags a missing PAN and a type the scheme does not usually cover, without blocking", () => {
    const w = enrolmentWarnings([e({})], person, rules, "2026-10-01");
    expect(w.join(" ")).toMatch(/usually covers full time/);
    expect(w.join(" ")).toMatch(/No PAN/);
  });
  it("flags the exemption without a scheme that allows it, and says nothing for someone with no scheme", () => {
    expect(enrolmentWarnings([e({ scheme: "pf", registrationNumber: "P-1" })], { ...person, employmentType: "full_time", panNumber: "123", sstEligible: true }, NEPAL_DEFAULT_RULES, "2026-10-01").join(" ")).toMatch(/first-band exemption/);
    expect(enrolmentWarnings([], { ...person, sstEligible: false }, NEPAL_DEFAULT_RULES, "2026-10-01")).toEqual([]);
  });
});
