import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, complianceTaxHeads, platformTaxRates, taxRates, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listPlatformTaxRates, publishTaxRate, rateTypesFor, updatePublishedRate } from "./platform-tax-rates";
import { getTaxRate } from "./tax-rates";
import { setOwnTaxRate } from "@/test/org-tax-rate";

// A throwaway country, so the real organizations and rates are never touched.
const CODE = "ZR";
let a: Awaited<ReturnType<typeof createTempOrg>>;
let b: Awaited<ReturnType<typeof createTempOrg>>;

const publish = (over: Partial<Parameters<typeof publishTaxRate>[1]>) => publishTaxRate(a.userId, { countryCode: CODE, taxTypeKey: "vat", rate: 13, effectiveFrom: "2020-01-01", isVerified: false, source: "", ...over });
const openRow = async (tenantId: string) => (await db.select().from(taxRates).where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.taxTypeKey, "vat"))).orderBy(taxRates.effectiveFrom)).filter((r) => r.effectiveTo === null)[0];

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Rate test country", currency: "ZZZ", statutoryCalendar: "AD" }).onConflictDoNothing();
  // TDS is split into headings: two paid by percentage (one of them switched off later) and one worked out from slabs
  await db.insert(complianceTaxHeads).values([
    { countryCode: CODE, key: "rent", name: "Rent", sortOrder: 1 },
    { countryCode: CODE, key: "services", name: "Services", sortOrder: 2 },
    { countryCode: CODE, key: "salary", name: "Salary", kind: "slabs", module: "payroll", sortOrder: 0 },
  ]).onConflictDoNothing();
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
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
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
    expect(listed.versions.vat).toEqual([expect.objectContaining({ rate: 13, effectiveFrom: "2020-01-01", effectiveTo: null, isVerified: true, source: "Finance Act", inForce: true })]);
    expect(listed.organizations.every((o) => o.followsPublished)).toBe(true);
  });

  it("a later rate closes the one before it the day before, and past dates still find the old rate", async () => {
    expect(await publish({ rate: 10, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: true, organizationsUpdated: 2 });
    expect(await getTaxRate(a.tenantId, "vat", "2025-06-01")).toBe(13);
    expect(await getTaxRate(a.tenantId, "vat", "2026-01-01")).toBe(10);
    const versions = (await listPlatformTaxRates(CODE, "2026-10-10")).versions.vat;
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
    await setOwnTaxRate(b.tenantId, b.userId, { taxTypeKey: "vat", rate: 11, effectiveFrom: "2026-09-01" });
    const r = await publish({ rate: 12, effectiveFrom: "2026-06-01" });
    expect(r).toMatchObject({ ok: true, organizationsUpdated: 1 });
    if (r.ok) expect(r.skipped).toHaveLength(1);
    expect(Number((await openRow(b.tenantId)).rate)).toBe(11); // B kept its own
    expect(Number((await openRow(a.tenantId)).rate)).toBe(12);
    const listed = await listPlatformTaxRates(CODE, "2026-10-10");
    expect(listed.organizations.find((o) => o.id === b.tenantId)?.followsPublished).toBe(false);
    expect(listed.organizations.find((o) => o.id === a.tenantId)?.followsPublished).toBe(true);
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
    const [v] = (await listPlatformTaxRates(CODE, "2026-10-10")).versions.vat;
    expect(await updatePublishedRate(a.userId, { id: v.id, isVerified: false, source: "Corrected note" })).toEqual({ ok: true });
    const [after] = (await listPlatformTaxRates(CODE, "2026-10-10")).versions.vat;
    expect(after).toMatchObject({ rate: 13, effectiveFrom: "2020-01-01", isVerified: false, source: "Corrected note" });
  });

  it("Income tax has its own timeline, and each organization lists what it uses for every tax", async () => {
    const r = await publishTaxRate(a.userId, { countryCode: CODE, taxTypeKey: "income_tax", rate: 25, effectiveFrom: "2020-01-01", isVerified: false, source: "" });
    expect(r).toMatchObject({ ok: true, organizationsUpdated: 2 });
    const listed = await listPlatformTaxRates(CODE, "2026-10-10");
    expect(listed.versions.income_tax).toEqual([expect.objectContaining({ rate: 25, inForce: true })]);
    expect(listed.organizations.find((o) => o.id === a.tenantId)?.rates.income_tax).toMatchObject({ rate: 25, source: "platform" });
    expect(await publishTaxRate(a.userId, { countryCode: CODE, taxTypeKey: "nonsense", rate: 5, effectiveFrom: "2030-01-01", isVerified: false, source: "" })).toMatchObject({ ok: false });
  });

  it("TDS has no single rate: each heading paid by percentage has its own, and a slab heading has none", async () => {
    expect((await rateTypesFor(CODE)).map((t) => t.key)).toEqual(["vat", "income_tax", "tds.rent", "tds.services"]);
    expect((await rateTypesFor(CODE)).find((t) => t.key === "tds.rent")?.label).toBe("Rent TDS");
    expect(await publish({ taxTypeKey: "tds", rate: 5, effectiveFrom: "2030-01-01" })).toMatchObject({ ok: false });
    expect(await publish({ taxTypeKey: "tds.salary", rate: 5, effectiveFrom: "2030-01-01" })).toMatchObject({ ok: false });
    expect(await publish({ taxTypeKey: "tds.nothing", rate: 5, effectiveFrom: "2030-01-01" })).toMatchObject({ ok: false });
  });

  it("a heading's rate is published into every organization under its own key, separate from the other headings", async () => {
    const r = await publish({ taxTypeKey: "tds.rent", rate: 10, effectiveFrom: "2026-01-01", isVerified: true });
    expect(r).toMatchObject({ ok: true, organizationsUpdated: 2 });
    expect(await publish({ taxTypeKey: "tds.services", rate: 15, effectiveFrom: "2026-01-01" })).toMatchObject({ ok: true });
    expect(await getTaxRate(a.tenantId, "tds.rent", "2026-06-01")).toBe(10);
    expect(await getTaxRate(a.tenantId, "tds.services", "2026-06-01")).toBe(15);
    expect(await getTaxRate(a.tenantId, "tds.rent", "2025-06-01")).toBe(0); // before it started, and no fallback for a heading
    const listed = await listPlatformTaxRates(CODE, "2026-10-10");
    expect(listed.versions["tds.rent"]).toEqual([expect.objectContaining({ rate: 10, inForce: true })]);
    expect(listed.organizations.find((o) => o.id === a.tenantId)?.rates["tds.rent"]).toMatchObject({ rate: 10, source: "platform" });
  });
});
