import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, platformTaxRateDrafts, platformTaxRates } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { confirmCarryForward, ensureCarryForward, fiscalYearsFor, listPlatformTaxRates, listRateDrafts, publishTaxRate } from "./platform-tax-rates";

// A throwaway country whose fiscal year is the calendar year, so the real countries and rates are never touched.
const CODE = "ZY";
let admin: Awaited<ReturnType<typeof createTempOrg>>;

const publish = (over: Partial<Parameters<typeof publishTaxRate>[1]>) => publishTaxRate(admin.userId, { countryCode: CODE, taxTypeKey: "vat", rate: 13, effectiveFrom: "2026-01-01", isVerified: false, source: "", ...over });

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Rate years test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1 }).onConflictDoNothing();
  admin = await createTempOrg("ZZ Rate Years");
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_tax_rate"), like(auditLog.entityId, CODE + ":%")));
  await db.delete(platformTaxRateDrafts).where(eq(platformTaxRateDrafts.countryCode, CODE));
  await db.delete(platformTaxRates).where(eq(platformTaxRates.countryCode, CODE));
  await admin.remove();
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("rates by fiscal year", () => {
  it("numbers the versions inside each fiscal year, so a change made during the year is v2", async () => {
    expect(await publish({ rate: 13, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: true });
    expect(await publish({ rate: 14, effectiveFrom: "2026-07-01" })).toMatchObject({ ok: true });
    const versions = (await listPlatformTaxRates(CODE, "2026-10-10")).versions.vat;
    expect(versions.map((v) => [v.fiscalYear, v.version, v.rate])).toEqual([["2026", 1, 13], ["2026", 2, 14]]);
    const years = (await fiscalYearsFor(CODE, "2026-10-10")).map((y) => y.label);
    expect([years[0], years[years.length - 1], years.length]).toEqual(["2004", "2027", 24]); // every year from the first one to one ahead
  });

  it("does not start next year's rates early, then carries each rate forward as a draft that changes nothing", async () => {
    await ensureCarryForward(CODE, "2026-06-01");
    expect(await listRateDrafts(CODE)).toEqual([]);
    await ensureCarryForward(CODE, "2026-11-15");
    await ensureCarryForward(CODE, "2026-12-01"); // twice is the same as once
    expect(await listRateDrafts(CODE)).toEqual([expect.objectContaining({ taxTypeKey: "vat", rate: 14, effectiveFrom: "2027-01-01" })]);
    expect((await listPlatformTaxRates(CODE, "2026-12-01")).versions.vat).toHaveLength(2); // nothing published yet
  });

  it("confirming publishes the draft as the new year's v1, even when the rate stays the same", async () => {
    const [draft] = await listRateDrafts(CODE);
    expect(await publish({ rate: 14, effectiveFrom: "2027-01-01" })).toMatchObject({ ok: false }); // an ordinary publish still needs a different rate
    const r = await confirmCarryForward(admin.userId, { draftId: draft.id, rate: 14, effectiveFrom: "2027-01-01", source: "Carried forward", isVerified: false });
    expect(r).toMatchObject({ ok: true });
    expect(await listRateDrafts(CODE)).toEqual([]);
    const versions = (await listPlatformTaxRates(CODE, "2027-02-01")).versions.vat;
    expect(versions.map((v) => [v.fiscalYear, v.version, v.rate])).toEqual([["2026", 1, 13], ["2026", 2, 14], ["2027", 1, 14]]);
    expect(versions[1].effectiveTo).toBe("2026-12-31");
    expect(await confirmCarryForward(admin.userId, { draftId: draft.id, rate: 14, effectiveFrom: "2027-01-01", source: "", isVerified: false })).toMatchObject({ ok: false });
  });

  it("a draft can be edited before it is confirmed, but only to a date inside its own fiscal year", async () => {
    await ensureCarryForward(CODE, "2027-12-01");
    const [draft] = await listRateDrafts(CODE);
    expect(draft).toMatchObject({ rate: 14, effectiveFrom: "2028-01-01" });
    expect(await confirmCarryForward(admin.userId, { draftId: draft.id, rate: 15, effectiveFrom: "2029-01-01", source: "", isVerified: false })).toMatchObject({ ok: false });
    expect(await confirmCarryForward(admin.userId, { draftId: draft.id, rate: 15, effectiveFrom: "2028-04-01", source: "Budget", isVerified: true })).toMatchObject({ ok: true });
    const versions = (await listPlatformTaxRates(CODE, "2028-05-01")).versions.vat;
    expect(versions[versions.length - 1]).toMatchObject({ fiscalYear: "2028", version: 1, rate: 15, effectiveFrom: "2028-04-01", inForce: true });
  });

  it("a year before the first published version can be set, but a year between two versions cannot", async () => {
    expect(await publish({ taxTypeKey: "income_tax", rate: 25, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: true });
    expect(await publish({ taxTypeKey: "income_tax", rate: 20, effectiveFrom: "2024-01-01" })).toMatchObject({ ok: true });
    const v = (await listPlatformTaxRates(CODE, "2026-10-10")).versions.income_tax;
    expect(v.map((x) => [x.effectiveFrom, x.effectiveTo, x.rate])).toEqual([["2024-01-01", "2025-12-31", 20], ["2026-01-01", null, 25]]);
    expect(await publish({ taxTypeKey: "income_tax", rate: 22, effectiveFrom: "2025-03-01" })).toMatchObject({ ok: false });
  });
});
