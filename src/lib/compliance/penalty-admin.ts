import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { compliancePenaltyRules } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { addDays, bsFiscalYearOf, bsFiscalYearRange, todayIso, type IsoDate } from "@/lib/calendar";
import { fromForm, PENALTY_TYPES, penaltyType, type FormValues, type PenaltyTypeKey } from "./penalty-types";

// Fines and penalties, kept as versions: each version starts on Shrawan 1 of a fiscal year and runs until the next one starts,
// so a past period is always judged by the figures that applied then. The platform administrator manages them; every
// organization can read them. Plain server helpers, not server actions: the actions in app/admin check requirePlatformAdmin.
// Platform-level audit events are written with no tenant.

export type Version = {
  id: string;
  taxTypeKey: PenaltyTypeKey;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  /** "2083/84" for a version that starts on Shrawan 1, null for the original figures. */
  fiscalYear: string | null;
  params: unknown;
  isVerified: boolean;
  source: string | null;
  inForce: boolean;
  /** Starts in a future fiscal year: its figures can still be corrected or removed. */
  editable: boolean;
};

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const TYPE_KEYS = PENALTY_TYPES.map((t) => t.key);

/** The figures as text with the keys in a fixed order, so two copies of the same figures compare equal. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));

function toVersion(r: typeof compliancePenaltyRules.$inferSelect, today: IsoDate): Version {
  const fy = bsFiscalYearOf(r.effectiveFrom);
  const startsShrawan = Boolean(fy && fy.from === r.effectiveFrom);
  return {
    id: r.id,
    taxTypeKey: r.taxTypeKey as PenaltyTypeKey,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    fiscalYear: startsShrawan ? fy!.label : null,
    params: r.params,
    isVerified: r.isVerified,
    source: r.source,
    inForce: r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today),
    editable: r.effectiveFrom > today,
  };
}

/** Every version of the penalty types the platform manages, oldest first, grouped by type. */
export async function listPenaltyTimeline(countryCode: string, today: IsoDate = todayIso()): Promise<Record<PenaltyTypeKey, Version[]>> {
  const rows = await db
    .select()
    .from(compliancePenaltyRules)
    .where(and(eq(compliancePenaltyRules.countryCode, countryCode), inArray(compliancePenaltyRules.taxTypeKey, TYPE_KEYS)))
    .orderBy(asc(compliancePenaltyRules.effectiveFrom));
  const out = { vat: [], tds: [], excise_permit: [] } as Record<PenaltyTypeKey, Version[]>;
  for (const r of rows) out[r.taxTypeKey as PenaltyTypeKey].push(toVersion(r, today));
  return out;
}

/** The version in force today for each type (what organizations see), with the versions still to come. */
export async function currentPenaltyRates(countryCode: string, today: IsoDate = todayIso()) {
  const timeline = await listPenaltyTimeline(countryCode, today);
  return PENALTY_TYPES.map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    current: timeline[t.key].find((v) => v.inForce) ?? null,
    upcoming: timeline[t.key].filter((v) => v.effectiveFrom > today),
  }));
}

export type NewVersionInput = { countryCode: string; taxTypeKey: PenaltyTypeKey; /** The BS year the fiscal year starts in, e.g. 2083 for 2083/84. */ fiscalYearStart: number; form: FormValues; isVerified: boolean; source: string };

/** Adds a version that starts on Shrawan 1 of the chosen fiscal year, after the latest existing one, and ends the one before it. */
export async function createPenaltyVersion(adminId: string, input: NewVersionInput): Promise<Result> {
  if (!penaltyType(input.taxTypeKey)) return fail("Unknown penalty type.");
  const range = bsFiscalYearRange(input.fiscalYearStart);
  if (!range) return fail("That fiscal year is outside the supported calendar.");
  const checked = fromForm(input.taxTypeKey, input.form);
  if (!checked.ok) return checked;

  const existing = await db
    .select()
    .from(compliancePenaltyRules)
    .where(and(eq(compliancePenaltyRules.countryCode, input.countryCode), eq(compliancePenaltyRules.taxTypeKey, input.taxTypeKey)))
    .orderBy(asc(compliancePenaltyRules.effectiveFrom));
  const latest = existing[existing.length - 1];
  if (latest && range.from <= latest.effectiveFrom) {
    const fy = bsFiscalYearOf(latest.effectiveFrom);
    return fail(`Versions are added in order. The latest version starts ${fy && fy.from === latest.effectiveFrom ? `in fiscal year ${fy.label}` : "from the original date"}; choose a later fiscal year.`);
  }

  const [created] = await db.transaction(async (tx) => {
    if (latest) await tx.update(compliancePenaltyRules).set({ effectiveTo: addDays(range.from, -1) }).where(eq(compliancePenaltyRules.id, latest.id));
    return tx
      .insert(compliancePenaltyRules)
      .values({ countryCode: input.countryCode, taxTypeKey: input.taxTypeKey, effectiveFrom: range.from, params: checked.params, isVerified: input.isVerified, source: input.source.trim() || null })
      .returning({ id: compliancePenaltyRules.id });
  });
  await logAuditEvent({ userId: adminId, action: "penalty_rule_created", entityType: "penalty_rule", entityId: created.id, after: { country: input.countryCode, type: input.taxTypeKey, from: range.from, fiscalYear: range.label, params: checked.params, verified: input.isVerified, source: input.source.trim() || null } });
  return { ok: true };
}

export type UpdateVersionInput = { id: string; form: FormValues; isVerified: boolean; source: string };

/** The figures of a version can be corrected only before it starts. Verification and the source can be changed at any time. */
export async function updatePenaltyVersion(adminId: string, input: UpdateVersionInput, today: IsoDate = todayIso()): Promise<Result> {
  const [row] = await db.select().from(compliancePenaltyRules).where(eq(compliancePenaltyRules.id, input.id)).limit(1);
  if (!row || !TYPE_KEYS.includes(row.taxTypeKey as PenaltyTypeKey)) return fail("Version not found.");
  const type = row.taxTypeKey as PenaltyTypeKey;

  const checked = fromForm(type, input.form);
  if (!checked.ok) return checked;
  const started = row.effectiveFrom <= today;
  if (started && stable(checked.params) !== stable(row.params)) return fail("This version has already started, so its figures can't be changed. Add a new version from a later fiscal year instead.");
  const params = started ? row.params : checked.params;

  await db.update(compliancePenaltyRules).set({ params, isVerified: input.isVerified, source: input.source.trim() || null }).where(eq(compliancePenaltyRules.id, row.id));
  await logAuditEvent({
    userId: adminId,
    action: "penalty_rule_updated",
    entityType: "penalty_rule",
    entityId: row.id,
    before: { params: row.params, verified: row.isVerified, source: row.source },
    after: { params, verified: input.isVerified, source: input.source.trim() || null },
  });
  return { ok: true };
}

/** A version that has not started yet can be removed; the one before it then carries on. */
export async function deletePenaltyVersion(adminId: string, id: string, today: IsoDate = todayIso()): Promise<Result> {
  const [row] = await db.select().from(compliancePenaltyRules).where(eq(compliancePenaltyRules.id, id)).limit(1);
  if (!row || !TYPE_KEYS.includes(row.taxTypeKey as PenaltyTypeKey)) return fail("Version not found.");
  if (row.effectiveFrom <= today) return fail("This version has already started and can't be removed.");

  await db.transaction(async (tx) => {
    await tx.delete(compliancePenaltyRules).where(eq(compliancePenaltyRules.id, id));
    // The version before it, if it was ended by this one, carries on.
    await tx
      .update(compliancePenaltyRules)
      .set({ effectiveTo: null })
      .where(and(eq(compliancePenaltyRules.countryCode, row.countryCode), eq(compliancePenaltyRules.taxTypeKey, row.taxTypeKey), eq(compliancePenaltyRules.effectiveTo, addDays(row.effectiveFrom, -1))));
  });
  await logAuditEvent({ userId: adminId, action: "penalty_rule_deleted", entityType: "penalty_rule", entityId: id, before: { country: row.countryCode, type: row.taxTypeKey, from: row.effectiveFrom, params: row.params } });
  return { ok: true };
}
