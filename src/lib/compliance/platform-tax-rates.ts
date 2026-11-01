import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, complianceTaxHeads, platformTaxRateDrafts, platformTaxRates, taxRates, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addDays, fiscalYearOf, fiscalYearRange, type CalendarSystem } from "@/lib/calendar";
import { BASE_RATE_TYPES, headRateKey, type FiscalYear, type RateType, type RateVersion } from "./platform-tax-rate-types";

// Tax rates published for a whole country by a platform administrator. One timeline per country and tax type; a new version starts
// after the one in force, which is closed the day before. Publishing a version also writes it into every organization of the
// country (a tax_rates row with source "platform", which an organization can then no longer change on its own), so they are all
// on the same rate from the same date. An organization that already has a rate starting on or after the new date is left alone and
// listed, never overwritten.

export { BASE_RATE_TYPES, type FiscalYear, type RateType, type RateVersion } from "./platform-tax-rate-types";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());

/** Everything this country publishes a rate for: VAT, Income tax, and one rate per active TDS heading that is paid by percentage. */
export async function rateTypesFor(countryCode: string): Promise<RateType[]> {
  const heads = await db
    .select({ taxTypeKey: complianceTaxHeads.taxTypeKey, key: complianceTaxHeads.key, name: complianceTaxHeads.name })
    .from(complianceTaxHeads)
    .where(and(eq(complianceTaxHeads.countryCode, countryCode), eq(complianceTaxHeads.isActive, true), eq(complianceTaxHeads.kind, "rate")))
    .orderBy(asc(complianceTaxHeads.sortOrder), asc(complianceTaxHeads.name));
  return [...BASE_RATE_TYPES, ...heads.map((h) => ({ key: headRateKey(h.taxTypeKey, h.key), label: `${h.name} ${h.taxTypeKey.toUpperCase()}` }))];
}

async function fiscalCalendar(countryCode: string) {
  const [c] = await db.select({ calendar: complianceCountries.statutoryCalendar, startMonth: complianceCountries.fiscalYearStartMonth }).from(complianceCountries).where(eq(complianceCountries.code, countryCode)).limit(1);
  return { calendar: (c?.calendar ?? "AD") as CalendarSystem, startMonth: c?.startMonth ?? 1 };
}

/** The fiscal years worth showing: last year, this year and next year, plus any older year in which a version started. */
export async function fiscalYearsFor(countryCode: string, today: string): Promise<FiscalYear[]> {
  const { calendar, startMonth } = await fiscalCalendar(countryCode);
  const current = fiscalYearOf(calendar, startMonth, today);
  if (!current) return [];
  const starts = await db.selectDistinct({ from: platformTaxRates.effectiveFrom }).from(platformTaxRates).where(eq(platformTaxRates.countryCode, countryCode));
  const wanted = new Set([current.startYear - 1, current.startYear, current.startYear + 1]);
  for (const s of starts) {
    const y = fiscalYearOf(calendar, startMonth, s.from)?.startYear;
    if (y !== undefined) wanted.add(y);
  }
  return [...wanted]
    .sort((a, b) => a - b)
    .flatMap((y) => {
      const r = fiscalYearRange(calendar, startMonth, y);
      return r ? [{ startYear: y, label: r.label, from: r.from, to: r.to }] : [];
    });
}

/** The published rates of one country, per tax type, oldest first; and how each organization's rate compares to the one in force. */
export async function listPlatformTaxRates(countryCode: string, today: string) {
  const rows = await db.select().from(platformTaxRates).where(eq(platformTaxRates.countryCode, countryCode)).orderBy(asc(platformTaxRates.effectiveFrom));
  const types = await rateTypesFor(countryCode);
  const { calendar, startMonth } = await fiscalCalendar(countryCode);
  const versions = (type: string): RateVersion[] => {
    const seen = new Map<string, number>();
    return rows
      .filter((r) => r.taxTypeKey === type)
      .map((r) => {
        const fy = fiscalYearOf(calendar, startMonth, r.effectiveFrom)?.label ?? "";
        seen.set(fy, (seen.get(fy) ?? 0) + 1);
        return { fiscalYear: fy, version: seen.get(fy)!, id: r.id, rate: Number(r.rate), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isVerified: r.isVerified, source: r.source, inForce: r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today) };
      });
  };
  const byType: Record<string, RateVersion[]> = Object.fromEntries(types.map((t) => [t.key, versions(t.key)]));

  const orgs = await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants).where(eq(tenants.countryCode, countryCode)).orderBy(asc(tenants.companyName));
  const open = orgs.length ? await db.select().from(taxRates).where(and(inArray(taxRates.tenantId, orgs.map((o) => o.id)), isNull(taxRates.effectiveTo))) : [];
  const organizations = orgs.map((o) => {
    const rateOf = (type: string) => {
      const r = open.find((x) => x.tenantId === o.id && x.taxTypeKey === type);
      return r ? { rate: Number(r.rate), source: r.source as "manual" | "platform", effectiveFrom: r.effectiveFrom } : null;
    };
    const rates: Record<string, ReturnType<typeof rateOf>> = Object.fromEntries(types.map((t) => [t.key, rateOf(t.key)]));
    const latest = (type: string) => byType[type][byType[type].length - 1];
    const follows = (type: string, r: ReturnType<typeof rateOf>) => !latest(type) || (r !== null && r.source === "platform" && Math.abs(r.rate - latest(type).rate) < 0.005);
    return { id: o.id, name: o.name, rates, followsPublished: types.every((t) => follows(t.key, rates[t.key])) };
  });
  return { types, versions: byType, organizations };
}
export type PlatformTaxRates = Awaited<ReturnType<typeof listPlatformTaxRates>>;

export type PublishInput = { countryCode: string; taxTypeKey: string; rate: number; effectiveFrom: string; isVerified: boolean; source: string; /** A confirmed carry-forward may keep the same rate: it still starts the new fiscal year's first version. */ carryForward?: boolean };
export type PublishResult = { ok: true; organizationsUpdated: number; skipped: { name: string; reason: string }[] } | { ok: false; error: string };

/**
 * Publishes a new rate for a country and writes it into every organization there. The new version has to start after the one in
 * force (rates form one timeline, never inserted into the middle of history), and be a different rate.
 */
export async function publishTaxRate(adminId: string, input: PublishInput): Promise<PublishResult> {
  const types = await rateTypesFor(input.countryCode);
  const label = types.find((t) => t.key === input.taxTypeKey)?.label;
  if (!label) return { ok: false, error: "Choose a tax or heading that has a rate." };
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
    if (!input.carryForward && Math.abs(Number(current.rate) - input.rate) < 0.005) return { ok: false, error: `That is already the current rate (${Number(current.rate)}%).` };
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
      skipped.push({ name: org.name, reason: `already has a ${label} rate starting ${open.effectiveFrom}, on or after this date` });
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

const CARRY_FORWARD_DAYS = 60;

/**
 * Starts next fiscal year's rates from the ones in force: once the year is within 60 days of ending, every rate with a published version
 * and none starting next year gets a draft with the same rate, dated the first day of next year. A draft changes nothing until confirmed.
 */
export async function ensureCarryForward(countryCode: string, today: string) {
  const years = await fiscalYearsFor(countryCode, today);
  const next = years[years.length - 1];
  const current = years[years.length - 2];
  if (!next || !current || today < addDays(next.from, -CARRY_FORWARD_DAYS)) return;
  const rows = await db.select().from(platformTaxRates).where(eq(platformTaxRates.countryCode, countryCode)).orderBy(asc(platformTaxRates.effectiveFrom));
  const known = new Set((await rateTypesFor(countryCode)).map((t) => t.key));
  for (const type of known) {
    const mine = rows.filter((r) => r.taxTypeKey === type);
    const latest = mine[mine.length - 1];
    if (!latest || latest.effectiveFrom >= next.from) continue;
    await db.insert(platformTaxRateDrafts).values({ countryCode, taxTypeKey: type, rate: latest.rate, effectiveFrom: next.from }).onConflictDoNothing();
  }
}

/** The carried-forward rates still waiting to be confirmed. */
export async function listRateDrafts(countryCode: string) {
  const rows = await db.select().from(platformTaxRateDrafts).where(eq(platformTaxRateDrafts.countryCode, countryCode)).orderBy(asc(platformTaxRateDrafts.effectiveFrom));
  return rows.map((d) => ({ id: d.id, taxTypeKey: d.taxTypeKey, rate: Number(d.rate), effectiveFrom: d.effectiveFrom }));
}
export type RateDraft = Awaited<ReturnType<typeof listRateDrafts>>[number];

/** Confirms a carried-forward rate, possibly after the administrator changed the rate or the date: it is published as the new year's first version. */
export async function confirmCarryForward(adminId: string, input: { draftId: string; rate: number; effectiveFrom: string; source: string; isVerified: boolean }): Promise<PublishResult> {
  const [draft] = await db.select().from(platformTaxRateDrafts).where(eq(platformTaxRateDrafts.id, input.draftId)).limit(1);
  if (!draft) return { ok: false, error: "That carried-forward rate was already confirmed." };
  const years = await fiscalYearsFor(draft.countryCode, draft.effectiveFrom);
  const year = years.find((y) => y.from === draft.effectiveFrom);
  if (year && (input.effectiveFrom < year.from || input.effectiveFrom > year.to)) return { ok: false, error: `The date has to be inside fiscal year ${year.label}.` };
  const r = await publishTaxRate(adminId, { countryCode: draft.countryCode, taxTypeKey: draft.taxTypeKey, rate: input.rate, effectiveFrom: input.effectiveFrom, isVerified: input.isVerified, source: input.source, carryForward: true });
  if (r.ok) await db.delete(platformTaxRateDrafts).where(eq(platformTaxRateDrafts.id, draft.id));
  return r;
}
