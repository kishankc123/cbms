import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, tenantTaxRegistrations, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { generateObligations } from "./engine/generate";
import { ensureRenewalObligations, loadPermit, recordRenewal, setStandardRenewalFee, undoLatestRenewal } from "./excise-permit";

// 2026-10-08 is 22 Ashwin 2083, in fiscal year 2083/84. The permit was issued on 20 Magh 2078 (3 Feb 2022).
const TODAY = "2026-10-08";
let org: Awaited<ReturnType<typeof createTempOrg>>;

const renewal = (year: number, paidDate: string, fine = 0) => ({ fiscalYearStart: year, paidDate, feeAmount: 10000, penaltyAmount: fine, receiptReference: `R-${year}`, notes: "" });
const renewalItems = async () =>
  db
    .select({ label: complianceObligations.periodLabel, status: complianceObligations.status, due: complianceObligations.dueDate })
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, org.tenantId), eq(complianceObligations.taxTypeKey, "excise"), eq(complianceObligations.name, "Excise Permit Renewal")))
    .orderBy(asc(complianceObligations.periodStart));

beforeAll(async () => {
  org = await createTempOrg("ZZ Excise Permit");
  await db.update(tenants).set({ entityType: "private_limited", registrationDate: "2021-02-02" }).where(eq(tenants.id, org.tenantId));
  await db.delete(tenantTaxRegistrations).where(eq(tenantTaxRegistrations.tenantId, org.tenantId));
});
afterAll(async () => {
  await org.remove();
});

describe("the excise permit", () => {
  it("has no permit until an active excise registration has a permit date", async () => {
    expect(await loadPermit(org.tenantId, TODAY)).toBeNull();
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "excise", status: "active" });
    expect(await loadPermit(org.tenantId, TODAY)).toBeNull();
    // and compliance waits for the permit date
    expect(await generateObligations(org.tenantId, { today: TODAY })).toBe(0);
  });

  it("with the permit date, every unpaid fiscal year since the permit becomes a renewal item", async () => {
    await db.update(tenantTaxRegistrations).set({ effectiveDate: "2022-02-03" }).where(and(eq(tenantTaxRegistrations.tenantId, org.tenantId), eq(tenantTaxRegistrations.taxTypeKey, "excise")));
    const permit = (await loadPermit(org.tenantId, TODAY))!;
    expect(permit.status).toMatchObject({ state: "expired", coveredThrough: "2078/79", unpaidYears: [2079, 2080, 2081, 2082, 2083], cancelled: true });
    await generateObligations(org.tenantId, { today: TODAY });
    const items = await renewalItems();
    expect(items.map((i) => i.label)).toEqual(["Renewal for FY 2079/80", "Renewal for FY 2080/81", "Renewal for FY 2081/82", "Renewal for FY 2082/83", "Renewal for FY 2083/84"]);
    expect(items.every((i) => i.status === "pending")).toBe(true);
    expect(await ensureRenewalObligations(org.tenantId, TODAY)).toBe(0); // running it again adds nothing
  });

  it("renewals are recorded in order, with a real payment date", async () => {
    expect(await recordRenewal(org.tenantId, org.userId, renewal(2081, "2026-08-01"), TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/in order.*2079\/80/) });
    expect(await recordRenewal(org.tenantId, org.userId, renewal(2079, "2030-01-01"), TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    expect(await recordRenewal(org.tenantId, org.userId, { ...renewal(2079, "2026-08-01"), feeAmount: 0 }, TODAY)).toMatchObject({ ok: false });
    for (const y of [2079, 2080, 2081, 2082]) expect(await recordRenewal(org.tenantId, org.userId, renewal(y, "2026-08-01", 5000), TODAY)).toEqual({ ok: true });
    const items = await renewalItems();
    expect(items.map((i) => i.status)).toEqual(["paid", "paid", "paid", "paid", "pending"]);
  });

  it("the standard fee turns the late band into an amount", async () => {
    expect((await loadPermit(org.tenantId, TODAY))!.status.penalty).toMatchObject({ action: "restricted", rate: 0.5, fine: null }); // Ashwin is month 2: first band; no fee set yet
    expect(await setStandardRenewalFee(org.tenantId, org.userId, -1)).toMatchObject({ ok: false });
    expect(await setStandardRenewalFee(org.tenantId, org.userId, 10000)).toEqual({ ok: true });
    const p = (await loadPermit(org.tenantId, TODAY))!;
    expect(p.standardFee).toBe(10000);
    expect(p.status).toMatchObject({ state: "expired", monthsLate: 2, penalty: { action: "restricted", fine: 5000 }, cancelled: false });
    expect(p.ruleVerified).toBe(false); // the seeded bands are not yet verified
  });

  it("recording the current year brings the permit back to active, and the latest can be taken back", async () => {
    expect(await recordRenewal(org.tenantId, org.userId, renewal(2083, "2026-10-08", 5000), TODAY)).toEqual({ ok: true });
    expect((await loadPermit(org.tenantId, TODAY))!.status).toMatchObject({ state: "active", coveredThrough: "2083/84", validUntil: "2027-07-16" });
    expect((await renewalItems()).every((i) => i.status === "paid")).toBe(true);

    expect(await undoLatestRenewal(org.tenantId, org.userId, TODAY)).toEqual({ ok: true });
    expect((await loadPermit(org.tenantId, TODAY))!.status).toMatchObject({ state: "expired", unpaidYears: [2083] });
    expect((await renewalItems()).map((i) => i.status)).toEqual(["paid", "paid", "paid", "paid", "pending"]);
  });

  it("is in the renewal window through Shrawan, then late", async () => {
    expect((await loadPermit(org.tenantId, "2026-08-10"))!.status).toMatchObject({ state: "renewal_window" }); // 26 Shrawan 2083
    expect((await loadPermit(org.tenantId, "2026-08-25"))!.status).toMatchObject({ state: "expired", monthsLate: 1 }); // Bhadra
  });
});
