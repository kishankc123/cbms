import { describe, expect, it } from "vitest";
import { appliesProblem, appliesToCondition, conditionToApplies, EVERYONE } from "./applicability-form";

const VAT = { fact: "registered_tax_types", op: "includes", value: "vat" };

describe("who a requirement applies to, as plain choices", () => {
  it("no condition is every organization", () => {
    expect(conditionToApplies(null)).toEqual(EVERYONE);
    expect(appliesToCondition(EVERYONE)).toBeNull();
  });

  it("turns the rules the platform ships with into choices and back again unchanged", () => {
    const rules = [
      VAT,
      { all: [VAT, { fact: "vat_filing_frequency", op: "neq", value: "quarterly" }] },
      { all: [VAT, { fact: "vat_filing_frequency", op: "eq", value: "quarterly" }] },
      { any: [{ fact: "registered_tax_types", op: "includes", value: "tds" }, { fact: "has_employees", op: "eq", value: true }, { fact: "withholds_tax", op: "eq", value: true }] },
      { fact: "entity_type", op: "in", value: ["private_limited"] },
    ];
    for (const rule of rules) {
      const applies = conditionToApplies(rule);
      expect(applies, JSON.stringify(rule)).not.toBeNull();
      const back = appliesToCondition(applies!);
      // A one-item "in" list reads back as "is", which means the same thing.
      expect(JSON.stringify(back)).toBe(JSON.stringify(rule).replace('{"fact":"entity_type","op":"in","value":["private_limited"]}', '{"fact":"entity_type","op":"eq","value":"private_limited"}'));
    }
  });

  it("reads the choices a person made", () => {
    expect(conditionToApplies({ all: [VAT, { fact: "has_employees", op: "eq", value: false }] })).toEqual({
      match: "all",
      rows: [
        { kind: "registered", not: false, value: ["vat"] },
        { kind: "employees", not: true, value: [] },
      ],
    });
    expect(conditionToApplies({ not: VAT })).toEqual({ match: "all", rows: [{ kind: "registered", not: true, value: ["vat"] }] });
  });

  it("builds the condition from the choices", () => {
    expect(appliesToCondition({ match: "any", rows: [{ kind: "registered", not: false, value: ["tds"] }, { kind: "companyType", not: true, value: ["a", "b"] }] })).toEqual({
      any: [{ fact: "registered_tax_types", op: "includes", value: "tds" }, { not: { fact: "entity_type", op: "in", value: ["a", "b"] } }],
    });
  });

  it("leaves a rule that is too detailed for the choices alone", () => {
    expect(conditionToApplies({ all: [VAT, { any: [{ fact: "has_employees", op: "eq", value: true }, { fact: "withholds_tax", op: "eq", value: true }] }] })).toBeNull();
    expect(conditionToApplies({ fact: "country_code", op: "eq", value: "NP" })).toBeNull();
  });

  it("says what is missing", () => {
    expect(appliesProblem({ match: "all", rows: [{ kind: "registered", not: false, value: [] }] })).toMatch(/tax/);
    expect(appliesProblem({ match: "all", rows: [{ kind: "companyType", not: false, value: [] }] })).toMatch(/company type/);
    expect(appliesProblem({ match: "all", rows: [{ kind: "employees", not: false, value: [] }] })).toBeNull();
  });
});
