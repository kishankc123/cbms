import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, compliancePenaltyRules, memberships } from "@/db/schema";
import { createPenaltyVersion, currentPenaltyRates, deletePenaltyVersion, listPenaltyTimeline, updatePenaltyVersion } from "./penalty-admin";
import { toForm } from "./penalty-types";

// A throwaway country, so the real figures are never touched.
const CODE = "ZT";
const TODAY = "2026-10-08"; // inside FY 2083/84 (Shrawan 1 2083 = 17 July 2026)
let adminId: string;

const vatForm = (interest: string) => ({ ...toForm("vat", { filingDailyRate: 0.0005, filingFloor: 1000, latePaymentFlatRate: 0.1, interestAnnualRate: 0.15, quarterlyFilingFine: 1000 }), fields: { filingDailyRate: "0.05", filingFloor: "1000", latePaymentFlatRate: "10", interestAnnualRate: interest, quarterlyFilingFine: "1000" } });
const timeline = async () => (await listPenaltyTimeline(CODE, TODAY)).vat;

beforeAll(async () => {
  [{ userId: adminId }] = await db.select({ userId: memberships.userId }).from(memberships).limit(1);
  await db.insert(complianceCountries).values({ code: CODE, name: "Test country", currency: "ZZZ", statutoryCalendar: "BS" }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(compliancePenaltyRules).where(eq(compliancePenaltyRules.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("penalty rule versions", () => {
  it("the first version starts on Shrawan 1 of the chosen fiscal year", async () => {
    expect(await createPenaltyVersion(adminId, { countryCode: CODE, taxTypeKey: "vat", fiscalYearStart: 2082, form: vatForm("15"), isVerified: false, source: "" })).toEqual({ ok: true });
    const v = await timeline();
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ effectiveFrom: "2025-07-17", effectiveTo: null, fiscalYear: "2082/83", inForce: true, editable: false, isVerified: false });
  });

  it("a later version ends the one before it the day before it starts", async () => {
    expect(await createPenaltyVersion(adminId, { countryCode: CODE, taxTypeKey: "vat", fiscalYearStart: 2084, form: vatForm("12"), isVerified: true, source: "Finance Act 2084" })).toEqual({ ok: true });
    const v = await timeline();
    expect(v.map((x) => [x.fiscalYear, x.effectiveTo])).toEqual([["2082/83", "2027-07-16"], ["2084/85", null]]);
    expect(v[1]).toMatchObject({ inForce: false, editable: true, isVerified: true, source: "Finance Act 2084" });
  });

  it("versions are added in order: not at or before the latest", async () => {
    expect(await createPenaltyVersion(adminId, { countryCode: CODE, taxTypeKey: "vat", fiscalYearStart: 2083, form: vatForm("13"), isVerified: false, source: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/added in order/) });
    expect(await createPenaltyVersion(adminId, { countryCode: CODE, taxTypeKey: "vat", fiscalYearStart: 2084, form: vatForm("13"), isVerified: false, source: "" })).toMatchObject({ ok: false });
  });

  it("refuses figures that are not numbers", async () => {
    expect(await createPenaltyVersion(adminId, { countryCode: CODE, taxTypeKey: "vat", fiscalYearStart: 2085, form: vatForm("abc"), isVerified: false, source: "" })).toMatchObject({ ok: false });
    expect(await timeline()).toHaveLength(2);
  });

  it("a version that has started keeps its figures, but its verification and source can change", async () => {
    const started = (await timeline())[0];
    expect(await updatePenaltyVersion(adminId, { id: started.id, form: vatForm("99"), isVerified: true, source: "x" }, TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/already started/) });
    // the same figures, with verification ticked and a source
    expect(await updatePenaltyVersion(adminId, { id: started.id, form: vatForm("15"), isVerified: true, source: "IRD notice 2082" }, TODAY)).toEqual({ ok: true });
    expect((await timeline())[0]).toMatchObject({ isVerified: true, source: "IRD notice 2082" });
  });

  it("a version that has not started can be corrected", async () => {
    const upcoming = (await timeline())[1];
    expect(await updatePenaltyVersion(adminId, { id: upcoming.id, form: vatForm("11"), isVerified: true, source: "Finance Act 2084" }, TODAY)).toEqual({ ok: true });
    expect(((await timeline())[1].params as { interestAnnualRate: number }).interestAnnualRate).toBe(0.11);
  });

  it("organizations see the version in force, with the next one to come", async () => {
    const rates = await currentPenaltyRates(CODE, TODAY);
    const vat = rates.find((r) => r.key === "vat")!;
    expect(vat.current).toMatchObject({ fiscalYear: "2082/83" });
    expect(vat.upcoming.map((v) => v.fiscalYear)).toEqual(["2084/85"]);
    expect(rates.find((r) => r.key === "tds")!.current).toBeNull();
  });

  it("an upcoming version can be deleted and the one before carries on; a started one can't", async () => {
    const [started, upcoming] = await timeline();
    expect(await deletePenaltyVersion(adminId, started.id, TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/already started/) });
    expect(await deletePenaltyVersion(adminId, upcoming.id, TODAY)).toEqual({ ok: true });
    const v = await timeline();
    expect(v).toHaveLength(1);
    expect(v[0].effectiveTo).toBeNull();
  });

  it("every change is in the platform audit log", async () => {
    const rows = await db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.userId, adminId), eq(auditLog.entityType, "penalty_rule")));
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("penalty_rule_created")).toBe(true);
    expect(actions.has("penalty_rule_updated")).toBe(true);
    expect(actions.has("penalty_rule_deleted")).toBe(true);
  });
});
