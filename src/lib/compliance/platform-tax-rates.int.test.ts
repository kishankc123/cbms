import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, platformTaxRates, taxRates, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listPlatformTaxRates, publishTaxRate, updatePublishedRate } from "./platform-tax-rates";
import { changeTaxRate, getTaxRate } from "./tax-rates";

// A throwaway country, so the real organizations and rates are never touched.
const CODE = "ZR";
let a: Awaited<ReturnType<typeof createTempOrg>>;
let b: Awaited<ReturnType<typeof createTempOrg>>;

const publish = (over: Partial<Parameters<typeof publishTaxRate>[1]>) => publishTaxRate(a.userId, { countryCode: CODE, taxTypeKey: "vat", rate: 13, effectiveFrom: "2020-01-01", isVerified: false, source: "", ...over });
const openRow = async (tenantId: string) => (await db.select().from(taxRates).where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, "vat"))).orderBy(taxRates.effectiveFrom)).filter((r) => r.effectiveTo === null)[0];

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Rate test country", currency: "ZZZ", statutoryCalendar: "AD" }).onConflictDoNothing();
  a = await createTempOrg("ZZ Rates A");
  b = await createTempOrg("ZZ Rates B");
  await db.update(tenants).set({ countryCode: CODE }).where(eq(tenants.id, a.tenantId));
  await db.update(tenants).set({ countryCode: CODE }).where(eq(tenants.id, b.tenantId));
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_tax_rate"), like(auditLog.entityId, CODE + ":%")));
  await db.delete(platformTaxRates).where(eq(platformTaxRates.countryCode, CODE));
  await a.remove();
  await b.remove();
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("publishing a tax rate for a country", () => {
  it("writes the rate into every organization of the country, marked as published by the platform", async () => {
    const r = await publish({ rate: 13, effectiveFrom: "2020-01-01", source: "Finance Act", isVerified: true });
    expect(r).toMatchObject({ ok: true, organizationsUpdated: 2, skipped: [] });
    for (const org of [a, b]) {
      const row = await openRow(org.tenantId);
      expect(row).toMatchObject({ source: "platform", effectiveTo: null, effectiveFrom: "2020-01-01" });
      expect(Number(row.rate)).toBe(13);
    }
    const listed = await listPlatformTaxRates(CODE, "2026-10-10");
    expect(listed.vat).toEqual([expect.objectContaining({ rate: 13, effectiveFrom: "2020-01-01", effectiveTo: null, isVerified: true, source: "Finance Act", inForce: true })]);
    expect(listed.organizations.every((o) => o.followsPublished)).toBe(true);
  });

  it("a later rate closes the one before it the day before, and past dates still find the old rate", async () => {
    expect(await publish({ rate: 10, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: true, organizationsUpdated: 2 });
    expect(await getTaxRate(a.tenantId, "vat", "2025-06-01")).toBe(13);
    expect(await getTaxRate(a.tenantId, "vat", "2026-01-01")).toBe(10);
    const versions = (await listPlatformTaxRates(CODE, "2026-10-10")).vat;
    expect(versions.map((v) => [v.rate, v.effectiveTo])).toEqual([[13, "2025-12-31"], [10, null]]);
  });

  it("refuses a rate that does not start after the current one, or is the same rate", async () => {
    expect(await publish({ rate: 9, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/start after/) });
    expect(await publish({ rate: 9, effectiveFrom: "2025-01-01" })).toMatchObject({ ok: false });
    expect(await publish({ rate: 10, effectiveFrom: "2027-01-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/already the current rate/) });
    expect(await publish({ rate: 150, effectiveFrom: "2027-01-01" })).toMatchObject({ ok: false });
    expect(await publish({ rate: 9, effectiveFrom: "not a date" })).toMatchObject({ ok: false });
    expect(await publish({ taxTypeKey: "excise", rate: 9, effectiveFrom: "2027-01-01" })).toMatchObject({ ok: false });
  });

  it("leaves an organization alone that already has a rate on or after the new date, and says so", async () => {
    // B had its own rate scheduled; a published rate dated earlier must not overwrite it.
    const current = await openRow(b.tenantId);
    await db.update(taxRates).set({ source: "manual" }).where(eq(taxRates.id, current.id)); // so the organization may change it itself
    await changeTaxRate(b.tenantId, b.userId, { taxTypeKey: "vat", rate: 11, effectiveFrom: "2026-09-01" });
    const r = await publish({ rate: 12, effectiveFrom: "2026-06-01" });
    expect(r).toMatchObject({ ok: true, organizationsUpdated: 1 });
    if (r.ok) expect(r.skipped).toHaveLength(1);
    expect(Number((await openRow(b.tenantId)).rate)).toBe(11); // B kept its own
    expect(Number((await openRow(a.tenantId)).rate)).toBe(12);
    const listed = await listPlatformTaxRates(CODE, "2026-10-10");
    expect(listed.organizations.find((o) => o.id === b.tenantId)?.followsPublished).toBe(false);
    expect(listed.organizations.find((o) => o.id === a.tenantId)?.followsPublished).toBe(true);
  });

  it("an organization can no longer change a rate the platform published", async () => {
    await expect(changeTaxRate(a.tenantId, a.userId, { taxTypeKey: "vat", rate: 5, effectiveFrom: "2030-01-01" })).rejects.toThrow(/published by your administrator/);
  });

  it("records each publication in the audit log, for the platform and for every organization", async () => {
    const platform = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "platform_tax_rate"), eq(auditLog.entityId, CODE + ":vat"), eq(auditLog.action, "platform_tax_rate_published")));
    expect(platform.length).toBe(3);
    expect(platform.every((p) => p.tenantId === null)).toBe(true);
    const own = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, a.tenantId), eq(auditLog.action, "tax_rate_changed")));
    expect(own.length).toBe(3);
    expect(own[0].afterValue).toMatchObject({ source: "platform" });
  });

  it("verification and source can be changed on a published rate, its figures cannot", async () => {
    const [v] = (await listPlatformTaxRates(CODE, "2026-10-10")).vat;
    expect(await updatePublishedRate(a.userId, { id: v.id, isVerified: false, source: "Corrected note" })).toEqual({ ok: true });
    const [after] = (await listPlatformTaxRates(CODE, "2026-10-10")).vat;
    expect(after).toMatchObject({ rate: 13, effectiveFrom: "2020-01-01", isVerified: false, source: "Corrected note" });
  });
});
