import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, platformPayrollRuleVersions } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listRuleVersions, payrollRulesOn, publishRuleVersion, updateRuleVersionNotes } from "./platform-rules";
import { NEPAL_DEFAULT_RULES, type PayrollRules } from "./retirement-rules";

// A throwaway country so the real Nepal rules are never touched.
const CODE = "ZY";
let admin: Awaited<ReturnType<typeof createTempOrg>>;
const withPf = (employeePct: number): PayrollRules => ({ ...NEPAL_DEFAULT_RULES, schemes: { ...NEPAL_DEFAULT_RULES.schemes, pf: { ...NEPAL_DEFAULT_RULES.schemes.pf, lines: [{ key: "provident_fund", label: "Provident fund", employeePct, employerPct: 10 }] } } });
const publish = (over: Partial<Parameters<typeof publishRuleVersion>[1]>) => publishRuleVersion(admin.userId, { countryCode: CODE, effectiveFrom: "2026-07-17", rules: NEPAL_DEFAULT_RULES, isVerified: false, source: "", ...over });

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Rules test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1 }).onConflictDoNothing();
  admin = await createTempOrg("ZZ Payroll rules");
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_payroll_rules"), eq(auditLog.entityId, CODE)));
  await db.delete(platformPayrollRuleVersions).where(eq(platformPayrollRuleVersions.countryCode, CODE));
  await admin.remove();
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("payroll rules by date", () => {
  it("publishes a first version and refuses bad rules and bad dates", async () => {
    expect(await publish({ effectiveFrom: "soon" })).toMatchObject({ ok: false });
    expect(await publish({ rules: { ...NEPAL_DEFAULT_RULES, sst: { exemptBands: -1 } } })).toMatchObject({ ok: false });
    expect(await publish({ source: "Spec", isVerified: false })).toEqual({ ok: true });
    expect((await listRuleVersions(CODE, "2026-10-10"))[0]).toMatchObject({ effectiveFrom: "2026-07-17", effectiveTo: null, isVerified: false, inForce: true });
  });

  it("a change ends the old version the day before, so a past date still finds the rates it was worked on", async () => {
    expect(await publish({ effectiveFrom: "2027-07-17", rules: NEPAL_DEFAULT_RULES })).toMatchObject({ ok: false, error: expect.stringMatching(/same rules/) });
    expect(await publish({ effectiveFrom: "2026-07-17", rules: withPf(12) })).toMatchObject({ ok: false });
    expect(await publish({ effectiveFrom: "2027-07-17", rules: withPf(12) })).toEqual({ ok: true });
    expect((await listRuleVersions(CODE, "2027-08-01")).map((v) => [v.effectiveFrom, v.effectiveTo])).toEqual([["2026-07-17", "2027-07-16"], ["2027-07-17", null]]);
    // FY 2083/84 pay keeps the old PF rate, FY 2084/85 pay gets the new one
    expect((await payrollRulesOn(CODE, "2027-03-01"))?.rules.schemes.pf.lines[0].employeePct).toBe(10);
    expect((await payrollRulesOn(CODE, "2027-09-01"))?.rules.schemes.pf.lines[0].employeePct).toBe(12);
    expect(await payrollRulesOn(CODE, "2026-01-01")).toBeNull();
  });

  it("verification and source can be updated; the rules cannot", async () => {
    const [v] = await listRuleVersions(CODE, "2027-08-01");
    expect(await updateRuleVersionNotes(admin.userId, { id: v.id, isVerified: true, source: "Finance Act 2083" })).toEqual({ ok: true });
    expect((await listRuleVersions(CODE, "2027-08-01"))[0]).toMatchObject({ isVerified: true, source: "Finance Act 2083" });
  });

  it("Nepal starts with the specification's rules, marked unverified", async () => {
    const np = await payrollRulesOn("NP", "2026-11-05");
    expect(np).not.toBeNull();
    expect(np!.isVerified).toBe(false);
    expect(np!.rules.schemes.ssf.lines.map((l) => l.key)).toEqual(["provident_fund", "gratuity", "other"]);
  });
});
