import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, complianceModuleTaxes, complianceTaxHeads, complianceTaxTypes } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listModuleTaxes, removeModuleTax, saveModuleTax } from "./module-tax-admin";

// A throwaway country, so the real countries and their module taxes are never touched.
const CODE = "ZM";
let admin: Awaited<ReturnType<typeof createTempOrg>>;

const choice = { method: "flat", bearer: "collected", priceBasis: "inclusive", postsTo: "output_vat" };
const save = (over: Record<string, string> = {}) => saveModuleTax(admin.userId, { countryCode: CODE, moduleKey: "sales", taxTypeKey: "vat", ...choice, ...over });
const rows = async () => (await listModuleTaxes(CODE)).rows;

// Whatever an interrupted earlier run left behind is cleared first.
async function clear() {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "module_tax"), like(auditLog.entityId, CODE + ":%")));
  await db.delete(complianceModuleTaxes).where(eq(complianceModuleTaxes.countryCode, CODE));
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
}

beforeAll(async () => {
  await clear();
  await db.insert(complianceCountries).values({ code: CODE, name: "Module tax test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1 }).onConflictDoNothing();
  await db.insert(complianceTaxTypes).values([
    { countryCode: CODE, key: "vat", name: "VAT" },
    { countryCode: CODE, key: "tds", name: "TDS" },
    { countryCode: CODE, key: "pan", name: "PAN" },
  ]);
  await db.insert(complianceTaxHeads).values([
    { countryCode: CODE, key: "salary", name: "Salary", kind: "slabs", module: "payroll", sortOrder: 0 },
    { countryCode: CODE, key: "rent", name: "Rent", sortOrder: 1 },
  ]);
  admin = await createTempOrg("ZZ Module Taxes");
});
afterAll(async () => {
  await admin?.remove();
  await clear();
});

describe("applicable taxes by module", () => {
  it("lists the country's real taxes (not bookkeeping helpers like PAN), with no rows to begin with", async () => {
    const d = await listModuleTaxes(CODE);
    expect(d.taxes.map((t) => t.key)).toEqual(["vat", "tds"]);
    expect(d.rows).toEqual([]);
    expect(d.organizations).toBe(0);
  });

  it("applies a tax in a module, changes how, and takes it off again (the row is kept, switched off)", async () => {
    expect(await save()).toEqual({ ok: true, organizations: 0 });
    expect(await rows()).toEqual([expect.objectContaining({ moduleKey: "sales", taxTypeKey: "vat", method: "flat", bearer: "collected", priceBasis: "inclusive", postsTo: "output_vat", isActive: true })]);
    expect(await save({ priceBasis: "exclusive" })).toMatchObject({ ok: true });
    expect((await rows())).toHaveLength(1);
    expect((await rows())[0].priceBasis).toBe("exclusive");

    expect(await removeModuleTax(admin.userId, { countryCode: CODE, moduleKey: "sales", taxTypeKey: "vat" })).toMatchObject({ ok: true });
    expect((await rows())[0].isActive).toBe(false);
    expect(await removeModuleTax(admin.userId, { countryCode: CODE, moduleKey: "sales", taxTypeKey: "vat" })).toMatchObject({ ok: false, error: expect.stringMatching(/not applied/) });
    expect(await save()).toMatchObject({ ok: true }); // applying it again switches the same row back on
    expect((await rows())).toHaveLength(1);
    expect((await rows())[0].isActive).toBe(true);
  });

  it("refuses a tax, module or choice it does not know, in plain words", async () => {
    expect(await save({ taxTypeKey: "pan" })).toMatchObject({ ok: false, error: expect.stringMatching(/tax that this country has set up/) });
    expect(await save({ taxTypeKey: "nothing" })).toMatchObject({ ok: false });
    expect(await save({ moduleKey: "nowhere" })).toMatchObject({ ok: false, error: expect.stringMatching(/modules/) });
    expect(await save({ method: "magic" })).toMatchObject({ ok: false });
    expect(await save({ bearer: "nobody" })).toMatchObject({ ok: false });
    expect(await save({ priceBasis: "maybe" })).toMatchObject({ ok: false });
    expect(await save({ postsTo: "elsewhere" })).toMatchObject({ ok: false });
    expect(await saveModuleTax(admin.userId, { countryCode: "QQ", moduleKey: "sales", taxTypeKey: "vat", ...choice })).toMatchObject({ ok: false, error: expect.stringMatching(/not set up/) });
  });

  it("works out by heading or by slab only where the tax has the headings for it", async () => {
    expect(await save({ method: "heading" })).toMatchObject({ ok: false, error: expect.stringMatching(/VAT has no headings/) }); // VAT has none
    expect(await save({ moduleKey: "expenses", taxTypeKey: "tds", method: "heading", bearer: "withheld", priceBasis: "on_amount", postsTo: "tds_payable" })).toMatchObject({ ok: true });
    expect(await save({ moduleKey: "payroll", taxTypeKey: "tds", method: "slab", bearer: "withheld", priceBasis: "on_amount", postsTo: "tds_payable" })).toMatchObject({ ok: true });
    await db.update(complianceTaxHeads).set({ isActive: false }).where(and(eq(complianceTaxHeads.countryCode, CODE), eq(complianceTaxHeads.key, "salary")));
    expect(await save({ moduleKey: "payroll", taxTypeKey: "tds", method: "slab", bearer: "withheld", priceBasis: "on_amount", postsTo: "tds_payable" })).toMatchObject({ ok: false, error: expect.stringMatching(/slabs/) });
  });

  it("every change is in the platform audit log, with what it was before", async () => {
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "module_tax"), like(auditLog.entityId, CODE + ":%")));
    expect(new Set(log.map((l) => l.action))).toEqual(new Set(["module_tax_changed", "module_tax_removed"]));
    const changed = log.find((l) => l.action === "module_tax_changed" && (l.beforeValue as { priceBasis?: string } | null)?.priceBasis === "inclusive");
    expect(changed?.afterValue).toMatchObject({ priceBasis: "exclusive" });
  });

  it("Nepal starts with the taxes applied the way the modules already work", async () => {
    const np = (await listModuleTaxes("NP")).rows.filter((r) => r.isActive);
    const has = (moduleKey: string, taxTypeKey: string, method: string, bearer: string) => np.some((r) => r.moduleKey === moduleKey && r.taxTypeKey === taxTypeKey && r.method === method && r.bearer === bearer);
    expect(has("sales", "vat", "flat", "collected")).toBe(true);
    expect(has("purchases", "vat", "flat", "claimable")).toBe(true);
    expect(has("expenses", "tds", "heading", "withheld")).toBe(true);
    expect(has("payroll", "tds", "slab", "withheld")).toBe(true);
  });
});
