import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceTaxHeads, platformSlabDrafts, platformSlabVersions } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addDays, fiscalYearOf } from "@/lib/calendar";
import { CARRY_FORWARD_DAYS, fiscalCalendar, fiscalYearsFor } from "./platform-tax-rates";
import { checkSlabTables, sameSlabTables, type SlabTables } from "./slab-tables";

// Salary-tax slabs published for a whole country by a platform administrator, in numbered versions per fiscal year, the same way rates are:
// a new version starts after the latest one (which ends the day before) or before the earliest one (for a year nothing was set for), never
// in the middle of history. Organizations do not get a copy; payroll reads the version in force on the pay date.

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());

export type SlabVersion = {
  id: string;
  fiscalYear: string;
  /** Counts the versions that start in the same fiscal year (v1 is the first, v2 a change made during the year). */
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  tables: SlabTables;
  isVerified: boolean;
  source: string | null;
  inForce: boolean;
};

/** The published versions of one heading's slabs, oldest first. */
export async function listSlabVersions(countryCode: string, headKey: string, today: string): Promise<SlabVersion[]> {
  const rows = await db
    .select()
    .from(platformSlabVersions)
    .where(and(eq(platformSlabVersions.countryCode, countryCode), eq(platformSlabVersions.headKey, headKey)))
    .orderBy(asc(platformSlabVersions.effectiveFrom));
  const { calendar, startMonth } = await fiscalCalendar(countryCode);
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const fy = fiscalYearOf(calendar, startMonth, r.effectiveFrom)?.label ?? "";
    seen.set(fy, (seen.get(fy) ?? 0) + 1);
    return { id: r.id, fiscalYear: fy, version: seen.get(fy)!, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, tables: r.tables as SlabTables, isVerified: r.isVerified, source: r.source, inForce: r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today) };
  });
}

/** The slabs that apply on a date (what payroll uses), or null when nothing is published for it. */
export async function slabsOn(countryCode: string, headKey: string, date: string): Promise<{ id: string; label: string; tables: SlabTables } | null> {
  const found = (await listSlabVersions(countryCode, headKey, date)).filter((v) => v.effectiveFrom <= date && (!v.effectiveTo || v.effectiveTo >= date))[0];
  return found ? { id: found.id, label: `v${found.version} of ${found.fiscalYear}`, tables: found.tables } : null;
}

async function isSlabHead(countryCode: string, headKey: string) {
  const [h] = await db
    .select({ id: complianceTaxHeads.id })
    .from(complianceTaxHeads)
    .where(and(eq(complianceTaxHeads.countryCode, countryCode), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.key, headKey), eq(complianceTaxHeads.kind, "slabs"), eq(complianceTaxHeads.isActive, true)))
    .limit(1);
  return Boolean(h);
}

export type PublishSlabInput = { countryCode: string; headKey: string; effectiveFrom: string; tables: unknown; isVerified: boolean; source: string; /** A confirmed carry-forward may keep the same slabs: it still starts the new year's first version. */ carryForward?: boolean };
type Result = { ok: true } | { ok: false; error: string };

export async function publishSlabVersion(adminId: string, input: PublishSlabInput): Promise<Result> {
  if (!(await isSlabHead(input.countryCode, input.headKey))) return { ok: false, error: "Choose a heading that is worked out from slabs." };
  if (!isDate(input.effectiveFrom)) return { ok: false, error: "Enter a valid date for the slabs to start from." };
  const checked = checkSlabTables(input.tables);
  if (!checked.ok) return checked;

  const all = await db
    .select()
    .from(platformSlabVersions)
    .where(and(eq(platformSlabVersions.countryCode, input.countryCode), eq(platformSlabVersions.headKey, input.headKey)))
    .orderBy(asc(platformSlabVersions.effectiveFrom));
  const latest = all[all.length - 1];
  const earliest = all[0];
  const backfill = Boolean(earliest) && input.effectiveFrom < earliest.effectiveFrom;
  if (latest && !backfill) {
    if (input.effectiveFrom <= latest.effectiveFrom) return { ok: false, error: `The new slabs have to start after ${latest.effectiveFrom}, when the current ones started.` };
    if (!input.carryForward && sameSlabTables(latest.tables as SlabTables, checked.tables)) return { ok: false, error: "These are the same slabs as the current ones. Change something first." };
  }

  await db.transaction(async (tx) => {
    if (latest && !backfill) await tx.update(platformSlabVersions).set({ effectiveTo: addDays(input.effectiveFrom, -1) }).where(eq(platformSlabVersions.id, latest.id));
    await tx.insert(platformSlabVersions).values({
      countryCode: input.countryCode,
      headKey: input.headKey,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: backfill ? addDays(earliest.effectiveFrom, -1) : null,
      tables: checked.tables,
      isVerified: input.isVerified,
      source: input.source.trim() || null,
      createdBy: adminId,
    });
  });
  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "platform_slabs_published",
    entityType: "platform_slabs",
    entityId: `${input.countryCode}:${input.headKey}`,
    before: latest ? { effectiveFrom: latest.effectiveFrom, tables: latest.tables } : null,
    after: { effectiveFrom: input.effectiveFrom, tables: checked.tables, source: input.source.trim() || null, isVerified: input.isVerified },
  });
  return { ok: true };
}

/** Ticks or unticks "verified" and edits the source of a published version. The slabs and the date never change once published. */
export async function updateSlabVersionNotes(adminId: string, input: { id: string; isVerified: boolean; source: string }): Promise<Result> {
  const [row] = await db.select().from(platformSlabVersions).where(eq(platformSlabVersions.id, input.id)).limit(1);
  if (!row) return { ok: false, error: "That version was not found." };
  await db.update(platformSlabVersions).set({ isVerified: input.isVerified, source: input.source.trim() || null }).where(eq(platformSlabVersions.id, input.id));
  await logAuditEvent({
    tenantId: null,
    userId: adminId,
    action: "platform_slabs_updated",
    entityType: "platform_slabs",
    entityId: `${row.countryCode}:${row.headKey}`,
    before: { isVerified: row.isVerified, source: row.source, effectiveFrom: row.effectiveFrom },
    after: { isVerified: input.isVerified, source: input.source.trim() || null, effectiveFrom: row.effectiveFrom },
  });
  return { ok: true };
}

/** Within 60 days of the year ending, every slab heading with a published version and none starting next year gets a draft copy for next year. */
export async function ensureSlabCarryForward(countryCode: string, today: string) {
  const years = await fiscalYearsFor(countryCode, today);
  const next = years[years.length - 1];
  if (!next || today < addDays(next.from, -CARRY_FORWARD_DAYS)) return;
  const heads = await db
    .select({ key: complianceTaxHeads.key })
    .from(complianceTaxHeads)
    .where(and(eq(complianceTaxHeads.countryCode, countryCode), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.kind, "slabs"), eq(complianceTaxHeads.isActive, true)));
  for (const { key } of heads) {
    const mine = await db.select().from(platformSlabVersions).where(and(eq(platformSlabVersions.countryCode, countryCode), eq(platformSlabVersions.headKey, key))).orderBy(asc(platformSlabVersions.effectiveFrom));
    const latest = mine[mine.length - 1];
    if (!latest || latest.effectiveFrom >= next.from) continue;
    await db.insert(platformSlabDrafts).values({ countryCode, headKey: key, effectiveFrom: next.from, tables: latest.tables }).onConflictDoNothing();
  }
}

/** The carried-forward slabs still waiting to be confirmed. */
export async function listSlabDrafts(countryCode: string) {
  const rows = await db.select().from(platformSlabDrafts).where(eq(platformSlabDrafts.countryCode, countryCode)).orderBy(asc(platformSlabDrafts.effectiveFrom));
  return rows.map((d) => ({ id: d.id, headKey: d.headKey, effectiveFrom: d.effectiveFrom, tables: d.tables as SlabTables }));
}
export type SlabDraft = Awaited<ReturnType<typeof listSlabDrafts>>[number];

/** Confirms carried-forward slabs, possibly after they were edited: they are published as the new year's first version. */
export async function confirmSlabDraft(adminId: string, input: { draftId: string; tables: unknown; effectiveFrom: string; source: string; isVerified: boolean }): Promise<Result> {
  const [draft] = await db.select().from(platformSlabDrafts).where(eq(platformSlabDrafts.id, input.draftId)).limit(1);
  if (!draft) return { ok: false, error: "Those carried-forward slabs were already confirmed." };
  const year = (await fiscalYearsFor(draft.countryCode, draft.effectiveFrom)).find((y) => y.from === draft.effectiveFrom);
  if (year && (input.effectiveFrom < year.from || input.effectiveFrom > year.to)) return { ok: false, error: `The date has to be inside fiscal year ${year.label}.` };
  const r = await publishSlabVersion(adminId, { countryCode: draft.countryCode, headKey: draft.headKey, effectiveFrom: input.effectiveFrom, tables: input.tables, isVerified: input.isVerified, source: input.source, carryForward: true });
  if (r.ok) await db.delete(platformSlabDrafts).where(eq(platformSlabDrafts.id, draft.id));
  return r;
}
