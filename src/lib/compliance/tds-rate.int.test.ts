import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, complianceTaxHeads, taxRates, tenants, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { tdsRateOn } from "./tds-rate";

// A throwaway country, so the real headings and rates are never touched.
const CODE = "ZY";
let org: Awaited<ReturnType<typeof createTempOrg>>;
const vendorOf = async (businessType: string | null) => (await db.insert(vendors).values({ tenantId: org.tenantId, name: `Supplier ${businessType ?? "none"}`, businessType }).returning())[0].id;
const rate = (key: string, value: string) => db.insert(taxRates).values({ tenantId: org.tenantId, taxTypeKey: key, rate: value, effectiveFrom: "2020-01-01", createdBy: org.userId });

beforeAll(async () => {
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
  await db.insert(complianceCountries).values({ code: CODE, name: "TDS rate test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1, isActive: false });
  await db.insert(complianceTaxHeads).values([
    { countryCode: CODE, key: "services", name: "Services", byPayeeType: true },
    { countryCode: CODE, key: "rent", name: "Rent", byPayeeType: false },
  ]);
  org = await createTempOrg("ZZ TDS Rate");
  await db.update(tenants).set({ countryCode: CODE }).where(eq(tenants.id, org.tenantId));
  await rate("tds.services", "15");
  await rate("tds.services.company", "1.5");
  await rate("tds.rent", "10");
});
afterAll(async () => {
  await org?.remove();
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("TDS rate by who is paid", () => {
  it("a company takes the company rate, a proprietorship the general rate", async () => {
    expect(await tdsRateOn(org.tenantId, "services", "2026-09-01", await vendorOf("company"))).toEqual({ rate: 1.5, basis: "company" });
    // No proprietorship rate is published, so the general rate is used and the form says so.
    expect(await tdsRateOn(org.tenantId, "services", "2026-09-01", await vendorOf("individual"))).toEqual({ rate: 15, basis: "no proprietorship / individual rate published, general rate used" });
  });

  it("a proprietorship rate, once published, is used for them", async () => {
    await rate("tds.services.individual", "10");
    expect(await tdsRateOn(org.tenantId, "services", "2026-09-01", await vendorOf("individual"))).toEqual({ rate: 10, basis: "proprietorship / individual" });
  });

  it("no supplier, or one with no type, takes the general rate and the form is told why", async () => {
    expect(await tdsRateOn(org.tenantId, "services", "2026-09-01")).toEqual({ rate: 15, basis: "supplier type not set" });
    expect(await tdsRateOn(org.tenantId, "services", "2026-09-01", await vendorOf(null))).toEqual({ rate: 15, basis: "supplier type not set" });
  });

  it("a heading whose rate does not depend on who is paid ignores the supplier's type", async () => {
    expect(await tdsRateOn(org.tenantId, "rent", "2026-09-01", await vendorOf("company"))).toEqual({ rate: 10, basis: null });
  });

  it("another organization's supplier is not looked at", async () => {
    const other = await createTempOrg("ZZ TDS Rate Other");
    try {
      const [v] = await db.insert(vendors).values({ tenantId: other.tenantId, name: "Their company", businessType: "company" }).returning();
      expect(await tdsRateOn(org.tenantId, "services", "2026-09-01", v.id)).toEqual({ rate: 15, basis: "supplier type not set" });
    } finally {
      await other.remove();
    }
  });
});
