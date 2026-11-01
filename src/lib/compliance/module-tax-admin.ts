import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, complianceModuleTaxes, complianceTaxHeads, complianceTaxTypes, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { NOT_TAXES } from "./config-tabs";
import { moduleLabel, TAX_BEARERS, TAX_METHODS, TAX_MODULES, TAX_POSTS_TO, TAX_PRICE_BASES, type ModuleTaxChoice } from "./module-taxes";

// Applicable taxes, for the platform administrator: which taxes apply in which module of a country, and how. Nothing here holds a rate.

export type ModuleTaxRow = ModuleTaxChoice & { id: string; moduleKey: string; taxTypeKey: string; isActive: boolean };
type Result = { ok: true; organizations: number } | { ok: false; error: string };

/** The taxes of a country that can be applied in a module (the real taxes, not bookkeeping helpers). */
async function countryTaxes(countryCode: string) {
  const rows = await db.select().from(complianceTaxTypes).where(and(eq(complianceTaxTypes.countryCode, countryCode), eq(complianceTaxTypes.isActive, true))).orderBy(asc(complianceTaxTypes.name));
  const order = ["vat", "tds", "income_tax"];
  const rank = (k: string) => order.indexOf(k) + 1 || 99;
  return rows.filter((t) => !(NOT_TAXES as readonly string[]).includes(t.key)).sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}

/** The country's taxes and every module-and-tax row, and how many organizations a change would reach. */
export async function listModuleTaxes(countryCode: string) {
  const [taxes, rows, orgs] = await Promise.all([
    countryTaxes(countryCode),
    db.select().from(complianceModuleTaxes).where(eq(complianceModuleTaxes.countryCode, countryCode)),
    db.select({ id: tenants.id }).from(tenants).where(eq(tenants.countryCode, countryCode)),
  ]);
  return {
    taxes: taxes.map((t) => ({ key: t.key, name: t.name })),
    rows: rows.map((r): ModuleTaxRow => ({ id: r.id, moduleKey: r.moduleKey, taxTypeKey: r.taxTypeKey, method: r.method, bearer: r.bearer, priceBasis: r.priceBasis, postsTo: r.postsTo, isActive: r.isActive })),
    organizations: orgs.length,
  };
}
export type ModuleTaxData = Awaited<ReturnType<typeof listModuleTaxes>>;

const known = (list: readonly { key: string }[], key: string) => list.some((x) => x.key === key);

export async function saveModuleTax(adminId: string, input: { countryCode: string; moduleKey: string; taxTypeKey: string } & ModuleTaxChoice): Promise<Result> {
  const [country] = await db.select({ code: complianceCountries.code }).from(complianceCountries).where(and(eq(complianceCountries.code, input.countryCode), eq(complianceCountries.isActive, true))).limit(1);
  if (!country) return { ok: false, error: "That country is not set up." };
  if (!known(TAX_MODULES, input.moduleKey)) return { ok: false, error: "Choose one of the modules." };
  const tax = (await countryTaxes(input.countryCode)).find((t) => t.key === input.taxTypeKey);
  if (!tax) return { ok: false, error: "Choose a tax that this country has set up." };
  if (!known(TAX_METHODS, input.method)) return { ok: false, error: "Choose how the tax is worked out." };
  if (!known(TAX_BEARERS, input.bearer)) return { ok: false, error: "Choose who bears the tax." };
  if (!known(TAX_PRICE_BASES, input.priceBasis)) return { ok: false, error: "Choose whether the price includes the tax." };
  if (!known(TAX_POSTS_TO, input.postsTo)) return { ok: false, error: "Choose where the tax posts." };

  // By heading and by slab need what they work from: headings under this tax, and a slab heading for slabs.
  if (input.method === "heading" || input.method === "slab") {
    const heads = await db.select({ kind: complianceTaxHeads.kind }).from(complianceTaxHeads).where(and(eq(complianceTaxHeads.countryCode, input.countryCode), eq(complianceTaxHeads.taxTypeKey, input.taxTypeKey), eq(complianceTaxHeads.isActive, true)));
    if (heads.length === 0) return { ok: false, error: `${tax.name} has no headings in this country, so it can't be worked out by heading or by slab.` };
    if (input.method === "slab" && !heads.some((h) => h.kind === "slabs")) return { ok: false, error: `${tax.name} has no heading that is worked out from slabs.` };
  }

  const where = and(eq(complianceModuleTaxes.countryCode, input.countryCode), eq(complianceModuleTaxes.moduleKey, input.moduleKey), eq(complianceModuleTaxes.taxTypeKey, input.taxTypeKey));
  const [before] = await db.select().from(complianceModuleTaxes).where(where).limit(1);
  const values = { method: input.method, bearer: input.bearer, priceBasis: input.priceBasis, postsTo: input.postsTo, isActive: true, updatedBy: adminId, updatedAt: new Date() };
  if (before) await db.update(complianceModuleTaxes).set(values).where(where);
  else await db.insert(complianceModuleTaxes).values({ countryCode: input.countryCode, moduleKey: input.moduleKey, taxTypeKey: input.taxTypeKey, ...values });

  const organizations = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.countryCode, input.countryCode))).length;
  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "module_tax_changed",
    entityType: "module_tax",
    entityId: `${input.countryCode}:${input.moduleKey}:${input.taxTypeKey}`,
    before: before ? { method: before.method, bearer: before.bearer, priceBasis: before.priceBasis, postsTo: before.postsTo, isActive: before.isActive } : null,
    after: { method: input.method, bearer: input.bearer, priceBasis: input.priceBasis, postsTo: input.postsTo, isActive: true, module: moduleLabel(input.moduleKey), organizations },
  });
  return { ok: true, organizations };
}

/** Marks a tax as not applied in a module. The row is kept (switched off) so its choices and history are not lost. */
export async function removeModuleTax(adminId: string, input: { countryCode: string; moduleKey: string; taxTypeKey: string }): Promise<Result> {
  const where = and(eq(complianceModuleTaxes.countryCode, input.countryCode), eq(complianceModuleTaxes.moduleKey, input.moduleKey), eq(complianceModuleTaxes.taxTypeKey, input.taxTypeKey));
  const [before] = await db.select().from(complianceModuleTaxes).where(where).limit(1);
  if (!before || !before.isActive) return { ok: false, error: "That tax is not applied in this module." };
  await db.update(complianceModuleTaxes).set({ isActive: false, updatedBy: adminId, updatedAt: new Date() }).where(where);
  const organizations = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.countryCode, input.countryCode))).length;
  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "module_tax_removed",
    entityType: "module_tax",
    entityId: `${input.countryCode}:${input.moduleKey}:${input.taxTypeKey}`,
    before: { method: before.method, bearer: before.bearer, priceBasis: before.priceBasis, postsTo: before.postsTo, isActive: true },
    after: { isActive: false, module: moduleLabel(input.moduleKey), organizations },
  });
  return { ok: true, organizations };
}
