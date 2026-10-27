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
  const names = { taxes: { vat: "VAT", tds: "TDS" }, entityTypes: { private_limited: "Private Limited", partnership: "Partnership" } };
  it("reads a combination in plain words", () => {
    expect(describeCondition({ all: [{ fact: "registered_tax_types", op: "includes", value: "vat" }, { fact: "vat_filing_frequency", op: "neq", value: "quarterly" }] }, names)).toBe(
      "Organizations that are registered for VAT and do not file VAT quarterly"
    );
    expect(describeCondition({ any: [{ fact: "has_employees", op: "eq", value: true }, { fact: "withholds_tax", op: "eq", value: true }] })).toBe("Organizations that have employees or withhold tax at source");
    expect(describeCondition(null)).toBe("Every organization");
  });
  it("names taxes and company types, and says what is not so", () => {
    expect(describeCondition({ not: { fact: "registered_tax_types", op: "includes", value: "tds" } }, names)).toBe("Organizations that are not registered for TDS");
    expect(describeCondition({ fact: "entity_type", op: "in", value: ["private_limited", "partnership"] }, names)).toBe("Organizations that are a Private Limited or Partnership");
    expect(describeCondition({ fact: "has_employees", op: "eq", value: false })).toBe("Organizations that have no employees");
  });
  it("puts a nested combination in brackets", () => {
    expect(describeCondition({ all: [{ fact: "entity_type", op: "eq", value: "private_limited" }, { any: [{ fact: "has_employees", op: "eq", value: true }, { fact: "withholds_tax", op: "eq", value: true }] }] }, names)).toBe(
      "Organizations that are a Private Limited and (have employees or withhold tax at source)"
    );
  });
});
