import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, platformTaxRates, taxRates, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addDays } from "@/lib/calendar";
import { PUBLISHABLE_TAX_TYPES, type PublishableTaxType, type RateVersion } from "./platform-tax-rate-types";

// Tax rates published for a whole country by a platform administrator. One timeline per country and tax type; a new version starts
// after the one in force, which is closed the day before. Publishing a version also writes it into every organization of the
// country (a tax_rates row with source "platform", which an organization can then no longer change on its own), so they are all
// on the same rate from the same date. An organization that already has a rate starting on or after the new date is left alone and
// listed, never overwritten.

export { PUBLISHABLE_TAX_TYPES, type PublishableTaxType, type RateVersion } from "./platform-tax-rate-types";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
const taxTypeLabel = (k: string) => PUBLISHABLE_TAX_TYPES.find((t) => t.key === k)?.label ?? k;

/** The published rates of one country, per tax type, oldest first; and how each organization's rate compares to the one in force. */
export async function listPlatformTaxRates(countryCode: string, today: string) {
  const rows = await db.select().from(platformTaxRates).where(eq(platformTaxRates.countryCode, countryCode)).orderBy(asc(platformTaxRates.effectiveFrom));
  const versions = (type: PublishableTaxType): RateVersion[] =>
    rows
      .filter((r) => r.taxTypeKey === type)
      .map((r) => ({ id: r.id, rate: Number(r.rate), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isVerified: r.isVerified, source: r.source, inForce: r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today) }));
  const byType = { vat: versions("vat"), tds: versions("tds") };

  const orgs = await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants).where(eq(tenants.countryCode, countryCode)).orderBy(asc(tenants.companyName));
  const open = orgs.length ? await db.select().from(taxRates).where(and(inArray(taxRates.tenantId, orgs.map((o) => o.id)), isNull(taxRates.effectiveTo))) : [];
  const organizations = orgs.map((o) => {
    const rateOf = (type: PublishableTaxType) => {
      const r = open.find((x) => x.tenantId === o.id && x.taxTypeKey === type);
      return r ? { rate: Number(r.rate), source: r.source as "manual" | "platform", effectiveFrom: r.effectiveFrom } : null;
    };
    const vat = rateOf("vat");
    const tds = rateOf("tds");
    const latest = (type: PublishableTaxType) => byType[type][byType[type].length - 1];
    const follows = (type: PublishableTaxType, r: ReturnType<typeof rateOf>) => !latest(type) || (r !== null && r.source === "platform" && Math.abs(r.rate - latest(type).rate) < 0.005);
    return { id: o.id, name: o.name, vat, tds, followsPublished: follows("vat", vat) && follows("tds", tds) };
  });
  return { ...byType, organizations };
}
export type PlatformTaxRates = Awaited<ReturnType<typeof listPlatformTaxRates>>;

export type PublishInput = { countryCode: string; taxTypeKey: string; rate: number; effectiveFrom: string; isVerified: boolean; source: string };
export type PublishResult = { ok: true; organizationsUpdated: number; skipped: { name: string; reason: string }[] } | { ok: false; error: string };

/**
 * Publishes a new rate for a country and writes it into every organization there. The new version has to start after the one in
 * force (rates form one timeline, never inserted into the middle of history), and be a different rate.
 */
export async function publishTaxRate(adminId: string, input: PublishInput): Promise<PublishResult> {
  if (!PUBLISHABLE_TAX_TYPES.some((t) => t.key === input.taxTypeKey)) return { ok: false, error: "Choose VAT or TDS." };
  if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) return { ok: false, error: "The rate must be a number between 0 and 100." };
  if (!isDate(input.effectiveFrom)) return { ok: false, error: "Enter a valid date for the rate to start from." };
  const [country] = await db.select({ code: complianceCountries.code }).from(complianceCountries).where(and(eq(complianceCountries.code, input.countryCode), eq(complianceCountries.isActive, true))).limit(1);
  if (!country) return { ok: false, error: "That country is not set up." };

  const [current] = await db
    .select()
    .from(platformTaxRates)
    .where(and(eq(platformTaxRates.countryCode, input.countryCode), eq(platformTaxRates.taxTypeKey, input.taxTypeKey), isNull(platformTaxRates.effectiveTo)))
    .limit(1);
  if (current) {
    if (input.effectiveFrom <= current.effectiveFrom) return { ok: false, error: `The new rate has to start after ${current.effectiveFrom}, when the current one started.` };
    if (Math.abs(Number(current.rate) - input.rate) < 0.005) return { ok: false, error: `That is already the current rate (${Number(current.rate)}%).` };
  }

  await db.transaction(async (tx) => {
    if (current) await tx.update(platformTaxRates).set({ effectiveTo: addDays(input.effectiveFrom, -1) }).where(eq(platformTaxRates.id, current.id));
    await tx.insert(platformTaxRates).values({ countryCode: input.countryCode, taxTypeKey: input.taxTypeKey, rate: input.rate.toFixed(2), effectiveFrom: input.effectiveFrom, isVerified: input.isVerified, source: input.source.trim() || null, createdBy: adminId });
  });

  // Every organization of the country.
  const orgs = await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants).where(eq(tenants.countryCode, input.countryCode));
  let updated = 0;
  const skipped: { name: string; reason: string }[] = [];
  for (const org of orgs) {
    const [open] = await db.select().from(taxRates).where(and(eq(taxRates.tenantId, org.id), eq(taxRates.taxTypeKey, input.taxTypeKey), isNull(taxRates.effectiveTo))).limit(1);
    if (open && open.effectiveFrom >= input.effectiveFrom) {
      skipped.push({ name: org.name, reason: `already has a ${taxTypeLabel(input.taxTypeKey)} rate starting ${open.effectiveFrom}, on or after this date` });
      continue;
    }
    await db.transaction(async (tx) => {
      if (open) await tx.update(taxRates).set({ effectiveTo: addDays(input.effectiveFrom, -1) }).where(eq(taxRates.id, open.id));
      await tx.insert(taxRates).values({ tenantId: org.id, taxTypeKey: input.taxTypeKey, rate: input.rate.toFixed(2), effectiveFrom: input.effectiveFrom, source: "platform", createdBy: adminId });
    });
    await logAuditEvent({
      tenantId: org.id,
      userId: adminId,
      action: "tax_rate_changed",
      entityType: "tax_rate",
      entityId: input.taxTypeKey,
      before: open ? { rate: Number(open.rate), effectiveFrom: open.effectiveFrom, source: open.source } : null,
      after: { rate: input.rate, effectiveFrom: input.effectiveFrom, source: "platform", publishedBy: "platform administrator" },
    });
    updated++;
  }

  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "platform_tax_rate_published",
    entityType: "platform_tax_rate",
    entityId: `${input.countryCode}:${input.taxTypeKey}`,
    before: current ? { rate: Number(current.rate), effectiveFrom: current.effectiveFrom } : null,
    after: { rate: input.rate, effectiveFrom: input.effectiveFrom, source: input.source.trim() || null, isVerified: input.isVerified, organizationsUpdated: updated, organizationsSkipped: skipped.length },
  });
  return { ok: true, organizationsUpdated: updated, skipped };
}

/** Ticks or unticks "verified" and edits the source of a published rate. The rate and its date never change once published. */
export async function updatePublishedRate(adminId: string, input: { id: string; isVerified: boolean; source: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db.select().from(platformTaxRates).where(eq(platformTaxRates.id, input.id)).limit(1);
  if (!row) return { ok: false, error: "That rate was not found." };
  await db.update(platformTaxRates).set({ isVerified: input.isVerified, source: input.source.trim() || null }).where(eq(platformTaxRates.id, input.id));
  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "platform_tax_rate_updated",
    entityType: "platform_tax_rate",
    entityId: `${row.countryCode}:${row.taxTypeKey}`,
    before: { isVerified: row.isVerified, source: row.source, effectiveFrom: row.effectiveFrom },
    after: { isVerified: input.isVerified, source: input.source.trim() || null, effectiveFrom: row.effectiveFrom },
  });
  return { ok: true };
}

/** The platform's published versions for a country, oldest first — what a new organization starts its rate history from. */
export async function publishedVersionsFor(countryCode: string, executor: Pick<typeof db, "select"> = db) {
  return executor.select().from(platformTaxRates).where(eq(platformTaxRates.countryCode, countryCode)).orderBy(asc(platformTaxRates.effectiveFrom), desc(platformTaxRates.createdAt));
}
