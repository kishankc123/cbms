import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, tenantTaxRegistrations, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { generateObligations } from "./generate";

// 2026-10-08 is 22 Ashwin 2083, in the fiscal year that began on Shrawan 1 (17 July 2026).
const TODAY = "2026-10-08";
let org: Awaited<ReturnType<typeof createTempOrg>>;

const vatPeriods = async () =>
  (
    await db
      .select({ label: complianceObligations.periodLabel })
      .from(complianceObligations)
      .where(and(eq(complianceObligations.tenantId, org.tenantId), eq(complianceObligations.taxTypeKey, "vat"), eq(complianceObligations.source, "generated")))
      .orderBy(asc(complianceObligations.periodStart))
  ).map((r) => r.label);

beforeAll(async () => {
  org = await createTempOrg("ZZ Compliance Start");
  // A fresh organization has an entity type and PAN from signup but nothing else.
  await db.update(tenants).set({ entityType: null, registrationDate: null }).where(eq(tenants.id, org.tenantId));
  await db.delete(tenantTaxRegistrations).where(eq(tenantTaxRegistrations.tenantId, org.tenantId));
});
afterAll(async () => {
  await org.remove();
});

describe("when compliance starts", () => {
  it("creates nothing until the company profile is complete", async () => {
    expect(await generateObligations(org.tenantId, { today: TODAY })).toBe(0);
    await db.update(tenants).set({ entityType: "private_limited" }).where(eq(tenants.id, org.tenantId));
    expect(await generateObligations(org.tenantId, { today: TODAY })).toBe(0); // the registration date is still missing
    expect((await db.select().from(complianceObligations).where(eq(complianceObligations.tenantId, org.tenantId))).length).toBe(0);
  });

  it("a VAT registration with no filing basis keeps compliance waiting", async () => {
    await db.update(tenants).set({ registrationDate: "2021-02-02" }).where(eq(tenants.id, org.tenantId)); // 20 Magh 2077
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active", effectiveDate: "2023-02-02" });
    expect(await generateObligations(org.tenantId, { today: TODAY })).toBe(0);
  });

  it("then covers every VAT month from Shrawan 1 of the current fiscal year, not just a window around today", async () => {
    await db.update(tenantTaxRegistrations).set({ filingFrequency: "monthly", filingFrequencyEffectiveFrom: "2023-02-02" }).where(and(eq(tenantTaxRegistrations.tenantId, org.tenantId), eq(tenantTaxRegistrations.taxTypeKey, "vat")));
    expect(await generateObligations(org.tenantId, { today: TODAY })).toBeGreaterThan(0);
    expect(await vatPeriods()).toEqual(["Shrawan 2083", "Bhadra 2083", "Ashwin 2083", "Kartik 2083", "Mangsir 2083"]);
  });

  it("running it again changes nothing", async () => {
    expect(await generateObligations(org.tenantId, { today: TODAY })).toBe(0);
  });

  it("never creates a VAT month that ended before the VAT registration took effect", async () => {
    // VAT takes effect on 25 Sep 2026 (9 Ashwin 2083): Shrawan and Bhadra are not owed, Ashwin onward are.
    await db.delete(complianceObligations).where(eq(complianceObligations.tenantId, org.tenantId));
    await db.update(tenantTaxRegistrations).set({ effectiveDate: "2026-09-25", filingFrequencyEffectiveFrom: "2026-09-25" }).where(and(eq(tenantTaxRegistrations.tenantId, org.tenantId), eq(tenantTaxRegistrations.taxTypeKey, "vat")));
    await generateObligations(org.tenantId, { today: TODAY });
    expect(await vatPeriods()).toEqual(["Ashwin 2083", "Kartik 2083", "Mangsir 2083"]);
  });

  it("an organization that joins late in the year still gets the whole year so far", async () => {
    // Falgun 2083 (about 1 March 2027): every month since Shrawan, with the VAT registration old enough to cover them all.
    await db.delete(complianceObligations).where(eq(complianceObligations.tenantId, org.tenantId));
    await db.update(tenantTaxRegistrations).set({ effectiveDate: "2023-02-02", filingFrequencyEffectiveFrom: "2023-02-02" }).where(and(eq(tenantTaxRegistrations.tenantId, org.tenantId), eq(tenantTaxRegistrations.taxTypeKey, "vat")));
    await generateObligations(org.tenantId, { today: "2027-03-01" });
    expect((await vatPeriods())[0]).toBe("Shrawan 2083");
    expect(await vatPeriods()).toContain("Falgun 2083");
    expect((await vatPeriods()).length).toBe(10); // Shrawan..Falgun (8), plus the next two months (Chaitra, Baisakh 2084)
  });
});
