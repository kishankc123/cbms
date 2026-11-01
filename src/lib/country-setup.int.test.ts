import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceAuthorities, complianceCountries, complianceEntityTypes, complianceTaxHeads, complianceTaxTypes } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { addSetupItem, listSetup, seedDefaultTaxes, updateSetupItem } from "./country-setup";

// A throwaway country, so a real country's setup is never touched.
const CODE = "ZV";
let org: Awaited<ReturnType<typeof createTempOrg>>;
let ADMIN: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Country Setup");
  ADMIN = org.userId;
  await db.insert(complianceCountries).values({ code: CODE, name: "Setup test country", currency: "ZZZ", statutoryCalendar: "AD" }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, CODE));
  await db.delete(complianceAuthorities).where(eq(complianceAuthorities.countryCode, CODE));
  await db.delete(complianceEntityTypes).where(eq(complianceEntityTypes.countryCode, CODE));
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(auditLog).where(eq(auditLog.entityId, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
  await org.remove();
});

describe("a country's company types, taxes and authorities", () => {
  it("starts with VAT and Income tax, and seeding again changes nothing", async () => {
    await seedDefaultTaxes(CODE);
    await seedDefaultTaxes(CODE);
    expect((await listSetup(CODE, "taxes")).rows.map((r) => r.name)).toEqual(["Income Tax", "VAT"]);
  });

  it("adds an item with a key made from its name, and refuses a name that is already there", async () => {
    expect(await addSetupItem(ADMIN, CODE, "company-types", { name: "  Private Limited " })).toEqual({ ok: true });
    expect(await addSetupItem(ADMIN, CODE, "company-types", { name: "private limited" })).toMatchObject({ ok: false });
    expect(await addSetupItem(ADMIN, CODE, "company-types", { name: "   " })).toMatchObject({ ok: false });
    const [row] = (await listSetup(CODE, "company-types")).rows;
    expect(row).toMatchObject({ key: "private_limited", name: "Private Limited", isActive: true });
  });

  it("renames, deactivates and activates, keeping the key", async () => {
    const [row] = (await listSetup(CODE, "company-types")).rows;
    expect(await updateSetupItem(ADMIN, "company-types", row.id, { name: "Company Limited" })).toEqual({ ok: true });
    expect(await updateSetupItem(ADMIN, "company-types", row.id, { isActive: false })).toEqual({ ok: true });
    expect((await listSetup(CODE, "company-types")).rows[0]).toMatchObject({ key: "private_limited", name: "Company Limited", isActive: false });
    await updateSetupItem(ADMIN, "company-types", row.id, { isActive: true });
    expect((await listSetup(CODE, "company-types")).rows[0].isActive).toBe(true);
  });

  it("a tax can be tied to an authority and registered for, and the authority can be changed", async () => {
    await addSetupItem(ADMIN, CODE, "authorities", { name: "Revenue Office" });
    const authority = (await listSetup(CODE, "authorities")).rows[0];
    expect(await addSetupItem(ADMIN, CODE, "taxes", { name: "Sales Duty", authorityKey: authority.key, isRegistrable: true })).toEqual({ ok: true });
    const { rows, authorities } = await listSetup(CODE, "taxes");
    expect(authorities).toEqual([{ key: authority.key, name: "Revenue Office" }]);
    const duty = rows.find((r) => r.name === "Sales Duty")!;
    expect(duty).toMatchObject({ key: "sales_duty", authorityKey: authority.key, isRegistrable: true });
    await updateSetupItem(ADMIN, "taxes", duty.id, { authorityKey: "" });
    expect((await listSetup(CODE, "taxes")).rows.find((r) => r.name === "Sales Duty")?.authorityKey).toBeNull();
  });

  it("TDS headings are a list like the others: added with a key made from the name, renamed, switched off", async () => {
    expect(await addSetupItem(ADMIN, CODE, "tds-headings", { name: "Interest" })).toEqual({ ok: true });
    expect(await addSetupItem(ADMIN, CODE, "tds-headings", { name: "interest" })).toMatchObject({ ok: false });
    const [row] = (await listSetup(CODE, "tds-headings")).rows;
    expect(row).toMatchObject({ key: "interest", name: "Interest", kind: "rate", module: "expenses", isActive: true });
    await updateSetupItem(ADMIN, "tds-headings", row.id, { name: "Interest paid" });
    await updateSetupItem(ADMIN, "tds-headings", row.id, { isActive: false });
    expect((await listSetup(CODE, "tds-headings")).rows[0]).toMatchObject({ key: "interest", name: "Interest paid", isActive: false });
  });
});
