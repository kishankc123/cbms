import { describe, expect, it } from "vitest";
import { isStillObligated, type ObligatedContext, type ObligationRef } from "./obligated-rules";

type Template = ObligatedContext["templates"] extends Map<string, infer T> ? T : never;
const tpl = (over: Partial<Template> & { id: string }): Template =>
  ({ countryCode: "NP", entityTypeKey: null, categoryKey: "tax", taxTypeKey: "vat", authorityKey: null, key: "t", name: "T", description: null, frequency: "monthly", periodCalendar: "statutory", applicability: null, dueRule: { period: "month" }, isActive: true, isVerified: true, activeFrom: null, activeTo: null, ...over }) as Template;

const base: ObligatedContext = {
  entityType: "private_limited",
  today: "2026-11-07",
  facts: { registered_tax_types: ["pan", "vat"], has_employees: false, withholds_tax: false },
  countryActive: true,
  templates: new Map([
    ["vat", tpl({ id: "vat", taxTypeKey: "vat", applicability: { fact: "registered_tax_types", op: "includes", value: "vat" } })],
    ["tds", tpl({ id: "tds", taxTypeKey: "tds", applicability: { any: [{ fact: "registered_tax_types", op: "includes", value: "tds" }, { fact: "has_employees", op: "eq", value: true }] } })],
    ["off", tpl({ id: "off", taxTypeKey: "vat", isActive: false })],
    ["other-entity", tpl({ id: "other-entity", entityTypeKey: "sole_proprietor" })],
    ["event", tpl({ id: "event", frequency: "event_based", dueRule: null, taxTypeKey: null, categoryKey: "ownership" })],
    ["always", tpl({ id: "always", taxTypeKey: "income_tax" })],
  ]),
  taxTypes: new Map([["pan", true], ["vat", true], ["tds", true], ["excise", true], ["income_tax", true], ["gone", false]]),
  registrable: new Set(["pan", "vat", "tds", "excise"]),
  activeRegistrations: new Set(["pan", "vat"]),
};
const row = (over: Partial<ObligationRef>): ObligationRef => ({ id: "x", templateId: null, source: "generated", taxTypeKey: null, status: "pending", ...over });
const yes = (r: ObligationRef, ctx = base) => isStillObligated(r, ctx);

describe("which open compliance items an organization is still obliged to", () => {
  it("keeps an item whose published template is on and applies (the tax is registered)", () => {
    expect(yes(row({ templateId: "vat", taxTypeKey: "vat" }))).toBe(true);
    expect(yes(row({ templateId: "always", taxTypeKey: "income_tax" }))).toBe(true); // no condition: applies to everyone in scope
  });
  it("drops it when the registration is no longer active", () => {
    expect(yes(row({ templateId: "vat", taxTypeKey: "vat" }), { ...base, facts: { ...base.facts, registered_tax_types: ["pan"] } })).toBe(false);
  });
  it("keeps a rule-driven item that applies through another fact, not a registration (TDS through employees)", () => {
    expect(yes(row({ templateId: "tds", taxTypeKey: "tds" }))).toBe(false);
    expect(yes(row({ templateId: "tds", taxTypeKey: "tds" }), { ...base, facts: { ...base.facts, has_employees: true } })).toBe(true);
  });
  it("drops it when the platform switched the template off, changed its entity type, or removed it", () => {
    expect(yes(row({ templateId: "off", taxTypeKey: "vat" }))).toBe(false);
    expect(yes(row({ templateId: "other-entity" }))).toBe(false);
    expect(yes(row({ templateId: "deleted" }))).toBe(false);
  });
  it("drops it when the platform unpublished the tax, or switched the country off", () => {
    expect(yes(row({ templateId: "always", taxTypeKey: "gone" }))).toBe(false);
    expect(yes(row({ templateId: "vat", taxTypeKey: "vat" }), { ...base, countryActive: false })).toBe(false);
  });
  it("counts an event-based requirement while it is switched on", () => {
    expect(yes(row({ templateId: "event" }))).toBe(true);
    expect(yes(row({ templateId: "event" }), { ...base, templates: new Map([["event", tpl({ id: "event", frequency: "event_based", isActive: false })]]) })).toBe(false);
  });
  it("counts an item without a template (the excise permit) only while that registration is active", () => {
    expect(yes(row({ taxTypeKey: "excise" }))).toBe(false);
    expect(yes(row({ taxTypeKey: "excise" }), { ...base, activeRegistrations: new Set(["excise"]) })).toBe(true);
    expect(yes(row({ taxTypeKey: "income_tax" }))).toBe(true); // not something one registers for
  });
  it("always keeps what a person entered, and what is already done", () => {
    expect(yes(row({ source: "manual", taxTypeKey: "excise" }))).toBe(true);
    expect(yes(row({ templateId: "off", status: "filed" }))).toBe(true);
    expect(yes(row({ templateId: "off", status: "not_applicable" }))).toBe(true);
  });
  it("never hides an item because a published condition can't be read", () => {
    const broken = new Map([["b", tpl({ id: "b", applicability: { nonsense: true } })]]);
    expect(yes(row({ templateId: "b" }), { ...base, templates: broken })).toBe(true);
  });
});
