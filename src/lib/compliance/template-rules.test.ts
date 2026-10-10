import { describe, expect, it } from "vitest";
import { describeCondition, describeDueRule, dueRuleToForm, formToDueRule, parseApplicability } from "./template-rules";

describe("a due rule in words", () => {
  it("reads the common patterns", () => {
    expect(describeDueRule({ period: "month", monthsAfterEnd: 1, dayOfMonth: 25 })).toBe("The 25th of the following month");
    expect(describeDueRule({ period: "month", monthsAfterEnd: 0, dayOfMonth: "last" })).toBe("The last day of the month the month ends in");
    expect(describeDueRule({ period: "fiscal_year", monthsAfterEnd: 3, dayOfMonth: "last" })).toBe("The last day of the 3rd month after the fiscal year ends");
    expect(describeDueRule({ period: "event", daysAfterEnd: 30 })).toBe("30 days after the end of the event");
    expect(describeDueRule({ period: "month", daysAfterEnd: 1 })).toBe("1 day after the end of the month");
    expect(describeDueRule(null)).toMatch(/No due date/);
  });
  it("says so when a rule is not valid", () => {
    expect(describeDueRule({ period: "week" })).toMatch(/Not understood/);
  });
});

describe("a condition in words", () => {
  it("reads a combination of facts", () => {
    expect(describeCondition({ all: [{ fact: "registered_tax_types", op: "includes", value: "vat" }, { fact: "vat_filing_frequency", op: "neq", value: "quarterly" }] })).toBe(
      "registered tax types includes vat and vat filing frequency is not quarterly"
    );
    expect(describeCondition({ any: [{ fact: "has_employees", op: "eq", value: true }, { fact: "withholds_tax", op: "eq", value: true }] })).toBe("has employees is true or withholds tax is true");
    expect(describeCondition(null)).toBe("Every organization");
  });
  it("puts a nested combination in brackets", () => {
    expect(describeCondition({ all: [{ fact: "entity_type", op: "in", value: ["private_limited", "partnership"] }, { any: [{ fact: "has_employees", op: "eq", value: true }, { fact: "withholds_tax", op: "eq", value: true }] }] })).toBe(
      "entity type is one of private_limited, partnership and (has employees is true or withholds tax is true)"
    );
  });
});

describe("the due date form", () => {
  it("builds a rule from a day of a later month", () => {
    expect(formToDueRule({ period: "month", mode: "day", monthsAfterEnd: "1", dayOfMonth: "25", daysAfterEnd: "" })).toEqual({ ok: true, rule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 } });
    expect(formToDueRule({ period: "fiscal_year", mode: "day", monthsAfterEnd: "6", dayOfMonth: "last", daysAfterEnd: "" })).toEqual({ ok: true, rule: { period: "fiscal_year", monthsAfterEnd: 6, dayOfMonth: "last" } });
  });
  it("builds a rule from a number of days", () => {
    expect(formToDueRule({ period: "quarter", mode: "days", monthsAfterEnd: "", dayOfMonth: "", daysAfterEnd: "21" })).toEqual({ ok: true, rule: { period: "quarter", daysAfterEnd: 21 } });
    expect(formToDueRule({ period: "event", mode: "day", monthsAfterEnd: "", dayOfMonth: "", daysAfterEnd: "30" })).toEqual({ ok: true, rule: { period: "event", daysAfterEnd: 30 } });
  });
  it("refuses numbers that make no sense", () => {
    expect(formToDueRule({ period: "month", mode: "day", monthsAfterEnd: "-1", dayOfMonth: "25", daysAfterEnd: "" })).toMatchObject({ ok: false });
    expect(formToDueRule({ period: "month", mode: "day", monthsAfterEnd: "1", dayOfMonth: "40", daysAfterEnd: "" })).toMatchObject({ ok: false });
    expect(formToDueRule({ period: "month", mode: "days", monthsAfterEnd: "", dayOfMonth: "", daysAfterEnd: "soon" })).toMatchObject({ ok: false });
    expect(formToDueRule({ period: "event", mode: "days", monthsAfterEnd: "", dayOfMonth: "", daysAfterEnd: "" })).toMatchObject({ ok: false });
  });
  it("round-trips an existing rule", () => {
    for (const rule of [{ period: "month", monthsAfterEnd: 1, dayOfMonth: 25 }, { period: "quarter", daysAfterEnd: 21 }, { period: "fiscal_year", monthsAfterEnd: 3, dayOfMonth: "last" }]) {
      expect(formToDueRule(dueRuleToForm(rule))).toEqual({ ok: true, rule });
    }
  });
});

describe("applicability text", () => {
  it("accepts a valid condition, and empty as every organization", () => {
    expect(parseApplicability("")).toEqual({ ok: true, condition: null });
    expect(parseApplicability('{"fact":"has_employees","op":"eq","value":true}')).toEqual({ ok: true, condition: { fact: "has_employees", op: "eq", value: true } });
  });
  it("refuses text that is not JSON or not a condition", () => {
    expect(parseApplicability("has employees")).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(parseApplicability('{"fact":"x","op":"like","value":1}')).toMatchObject({ ok: false });
    expect(parseApplicability('{"all":[]}')).toMatchObject({ ok: false });
  });
});
