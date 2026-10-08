import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, exciseRenewals, tenantTaxRegistrations, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { generateObligations } from "./engine/generate";
import { loadCatchup, saveCatchup } from "./catchup";
import { loadPermit } from "./excise-permit";
import { getVatWorksheet } from "./vat-worksheet";

// 2026-10-08 is 22 Ashwin 2083. The company was registered on 20 Magh 2078 (3 Feb 2022); VAT took effect on 20 Magh 2080
// (3 Feb 2024); the excise permit dates from 20 Magh 2078.
const TODAY = "2026-10-08";
const ASHADH_2083 = "2026-07-16"; // end of the latest finished fiscal year, 2082/83
let org: Awaited<ReturnType<typeof createTempOrg>>;

const items = (taxType: string) =>
  db
    .select({ label: complianceObligations.periodLabel, status: complianceObligations.status, flagged: complianceObligations.filedBeforeSystem, end: complianceObligations.periodEnd })
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, org.tenantId), eq(complianceObligations.taxTypeKey, taxType)))
    .orderBy(asc(complianceObligations.periodStart));
const vat = async () => (await items("vat")).filter((i) => i.label !== undefined);

beforeAll(async () => {
  org = await createTempOrg("ZZ Catch-up");
  await db.update(tenants).set({ entityType: null, registrationDate: null }).where(eq(tenants.id, org.tenantId));
  await db.delete(tenantTaxRegistrations).where(eq(tenantTaxRegistrations.tenantId, org.tenantId));
});
afterAll(async () => {
  await db.delete(exciseRenewals).where(eq(exciseRenewals.tenantId, org.tenantId));
  await org.remove();
});

describe("the compliance checklist", () => {
  it("waits for the company profile", async () => {
    expect((await loadCatchup(org.tenantId, TODAY)).ready).toBe(false);
    expect(await saveCatchup(org.tenantId, org.userId, { income_tax: null }, TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/company details/) });
  });

  it("offers the streams the organization has, each from its own start date", async () => {
    await db.update(tenants).set({ entityType: "private_limited", registrationDate: "2022-02-03" }).where(eq(tenants.id, org.tenantId));
    await db.insert(tenantTaxRegistrations).values([
      { tenantId: org.tenantId, taxTypeKey: "vat", status: "active", effectiveDate: "2024-02-03", filingFrequency: "monthly", filingFrequencyEffectiveFrom: "2024-02-03" },
      { tenantId: org.tenantId, taxTypeKey: "excise", status: "active", effectiveDate: "2022-02-03" },
    ]);
    const v = await loadCatchup(org.tenantId, TODAY);
    expect(v.ready).toBe(true);
    expect(v.streams.map((s) => s.key)).toEqual(["income_tax", "vat", "excise_return", "excise_permit"]); // no TDS: nothing withheld
    expect(v.unanswered).toBe(4);
    expect(v.streams[0].options.map((o) => o.label)).toEqual(["FY 2078/79", "FY 2079/80", "FY 2080/81", "FY 2081/82", "FY 2082/83"]);
    expect(v.streams[1].options[0].label).toBe("Magh 2080"); // VAT starts with its effective-from month
    expect(v.streams[1].options[v.streams[1].options.length - 1].label).toBe("Bhadra 2083"); // Ashwin is still running
    expect(v.latestFinishedYearEnd).toBe(ASHADH_2083);
  });

  it("before it is answered, only the current fiscal year is shown", async () => {
    await generateObligations(org.tenantId, { today: TODAY });
    expect((await vat())[0].label).toBe("Shrawan 2083");
  });

  it("refuses an answer that is not offered, or for a stream the organization does not have", async () => {
    expect(await saveCatchup(org.tenantId, org.userId, { vat: "2026-07-15" }, TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/one of the periods offered/) });
    expect(await saveCatchup(org.tenantId, org.userId, { tds: ASHADH_2083 }, TODAY)).toMatchObject({ ok: false, error: expect.stringMatching(/does not apply/) });
    expect(await saveCatchup(org.tenantId, org.userId, { excise_permit: null }, TODAY)).toMatchObject({ ok: false });
  });

  it("income tax and everything else filed through Ashadh 2083: the history is built and marked filed, the rest is owed", async () => {
    expect(await saveCatchup(org.tenantId, org.userId, { income_tax: ASHADH_2083, vat: ASHADH_2083, excise_return: ASHADH_2083, excise_permit: ASHADH_2083 }, TODAY)).toEqual({ ok: true });

    const months = await vat();
    expect(months[0].label).toBe("Magh 2080");
    const before = months.filter((m) => m.end! <= ASHADH_2083);
    expect(before.length).toBe(30); // Magh 2080 to Ashadh 2083
    expect(before.every((m) => m.status === "filed" && m.flagged)).toBe(true);
    const owed = months.filter((m) => m.end! > ASHADH_2083);
    expect(owed.map((m) => m.label)).toEqual(["Shrawan 2083", "Bhadra 2083", "Ashwin 2083", "Kartik 2083", "Mangsir 2083"]);
    expect(owed.every((m) => m.status === "pending" && !m.flagged)).toBe(true);

    const income = await items("income_tax");
    expect(income.map((i) => [i.label, i.status])).toEqual([["2078/79", "filed"], ["2079/80", "filed"], ["2080/81", "filed"], ["2081/82", "filed"], ["2082/83", "filed"], ["2083/84", "pending"]].map(([l, s]) => [expect.stringContaining(l), s]));
    expect((await items("excise")).filter((i) => i.label.startsWith("Magh 2078"))).toHaveLength(1); // the excise return starts with the permit month
  });

  it("the excise permit is renewed through the year, so only the current one is late", async () => {
    const renewals = await db.select().from(exciseRenewals).where(eq(exciseRenewals.tenantId, org.tenantId));
    expect(renewals).toHaveLength(4); // 2079/80 to 2082/83 (the year of issue needs no row)
    expect((await loadPermit(org.tenantId, TODAY))!.status).toMatchObject({ state: "expired", coveredThrough: "2082/83", monthsLate: 2 });
  });

  it("a period filed before the system never calculates a fine, and is settled", async () => {
    const { rows } = await getVatWorksheet(org.tenantId);
    const old = rows.filter((r) => r.filedBeforeSystem);
    expect(old.length).toBe(30);
    expect(old.every((r) => r.finesAndPenalties === 0 && r.daysDelayed === 0)).toBe(true);
  });

  it("changing an answer later moves the line: months after the new date are owed again", async () => {
    expect(await saveCatchup(org.tenantId, org.userId, { vat: "2025-07-16" }, TODAY)).toEqual({ ok: true }); // through Ashadh 2082
    const months = await vat();
    expect(months.filter((m) => m.flagged).length).toBe(18); // Magh 2080 to Ashadh 2082
    expect(months.find((m) => m.label === "Shrawan 2082")).toMatchObject({ status: "pending", flagged: false });
    // the other streams are untouched
    expect((await items("income_tax")).filter((i) => i.flagged)).toHaveLength(5);
  });

  it("answering none filed leaves every period owed", async () => {
    expect(await saveCatchup(org.tenantId, org.userId, { vat: null }, TODAY)).toEqual({ ok: true });
    expect((await vat()).every((m) => m.status === "pending" && !m.flagged)).toBe(true);
  });
});
