import { cookies } from "next/headers";
import { and, desc, eq, lte, gte } from "drizzle-orm";
import { db } from "@/db";
import { tenants, fiscalYears, type FiscalYearStatus } from "@/db/schema";
import { bsFiscalYearOf, bsFiscalYearRange, yearRange, todayIso } from "@/lib/calendar";
import type { DateRange } from "@/lib/calendar";

const FISCAL_YEAR_COLUMNS = {
  id: fiscalYears.id,
  code: fiscalYears.code,
  startDate: fiscalYears.startDate,
  endDate: fiscalYears.endDate,
  status: fiscalYears.status,
  closedAt: fiscalYears.closedAt,
  reopenedAt: fiscalYears.reopenedAt,
  reopenReason: fiscalYears.reopenReason,
};

export type FiscalYear = {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  closedAt: Date | null;
  reopenedAt: Date | null;
  reopenReason: string | null;
};

/** Every fiscal year on record for this tenant, most recent first. */
export async function listFiscalYears(tenantId: string): Promise<FiscalYear[]> {
  return db.select(FISCAL_YEAR_COLUMNS).from(fiscalYears).where(eq(fiscalYears.tenantId, tenantId)).orderBy(desc(fiscalYears.startDate));
}

/** The fiscal year a given AD date falls into, if one is already on record — does not create one. */
export async function getFiscalYearByDate(tenantId: string, dateIso: string): Promise<FiscalYear | null> {
  const [row] = await db
    .select(FISCAL_YEAR_COLUMNS)
    .from(fiscalYears)
    .where(and(eq(fiscalYears.tenantId, tenantId), lte(fiscalYears.startDate, dateIso), gte(fiscalYears.endDate, dateIso)))
    .limit(1);
  return row ?? null;
}

/** One specific fiscal year by id, scoped to the tenant — used to validate the user's picked fiscal
 * year (e.g. from the sidebar switcher's cookie) actually belongs to them before trusting it. */
export async function getFiscalYearById(tenantId: string, fiscalYearId: string): Promise<FiscalYear | null> {
  const [row] = await db.select(FISCAL_YEAR_COLUMNS).from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.id, fiscalYearId))).limit(1);
  return row ?? null;
}

/**
 * The fiscal year containing today, auto-creating it if none is on record yet — the "automatic fiscal
 * year detection" the spec calls for. First tries the org's already-configured fiscal year (the legacy
 * single start/end pair on `tenants`, kept as a denormalized cache of "current" — see syncTenantFiscalYearCache),
 * then falls back to the calendar engine's own BS fiscal-year rule (Shrawan 1 – Ashadh end) for a BS
 * organization, or the plain AD calendar year otherwise. Never invents a year that doesn't contain today.
 */
export async function getCurrentFiscalYear(tenantId: string): Promise<FiscalYear> {
  const today = todayIso();
  const existing = await getFiscalYearByDate(tenantId, today);
  if (existing) return existing;

  const [tenant] = await db.select({ calendarSystem: tenants.calendarSystem, startDate: tenants.fiscalYearStartDate, endDate: tenants.fiscalYearEndDate, label: tenants.fiscalYearLabel }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  let range: (DateRange & { code: string }) | null = null;
  if (tenant?.startDate && tenant.endDate && tenant.startDate <= today && today <= tenant.endDate) {
    range = { from: tenant.startDate, to: tenant.endDate, code: tenant.label || `${tenant.startDate.slice(0, 4)}` };
  } else if (tenant?.calendarSystem === "BS") {
    const fy = bsFiscalYearOf(today);
    if (fy) range = { from: fy.from, to: fy.to, code: fy.label };
  }
  if (!range) {
    const y = yearRange("AD", today);
    range = { from: y.from, to: y.to, code: y.from.slice(0, 4) };
  }

  const [created] = await db
    .insert(fiscalYears)
    .values({ tenantId, code: range.code, startDate: range.from, endDate: range.to, status: "open" })
    .onConflictDoNothing()
    .returning();
  const fy = created ?? (await getFiscalYearByDate(tenantId, today));
  if (!fy) throw new Error("Could not determine the current fiscal year");
  await syncTenantFiscalYearCache(tenantId, fy);
  return fy;
}

/** Keeps `tenants.fiscalYearLabel/StartDate/EndDate` — read by older display call sites — in step with
 * whichever fiscal year is actually current, so nothing needs to be migrated off them individually. */
async function syncTenantFiscalYearCache(tenantId: string, fy: Pick<FiscalYear, "code" | "startDate" | "endDate">) {
  await db.update(tenants).set({ fiscalYearLabel: fy.code, fiscalYearStartDate: fy.startDate, fiscalYearEndDate: fy.endDate }).where(eq(tenants.id, tenantId));
}

/** The organization's current fiscal year as real AD boundaries (independent of AD/BS display). */
export async function getFiscalRange(tenantId: string): Promise<DateRange | null> {
  const fy = await getCurrentFiscalYear(tenantId);
  return { from: fy.startDate, to: fy.endDate };
}

export function isFiscalYearOpen(fy: Pick<FiscalYear, "status">): boolean {
  return fy.status !== "closed";
}

/** Blocks posting/reversing into a closed fiscal year — the fiscal-year-level counterpart to
 * assertPeriodOpen (an arbitrary admin-defined period lock). A date with no fiscal year on record
 * yet is allowed through undecided rather than blocked, since getCurrentFiscalYear only auto-creates
 * a row for TODAY — a backdated date into an ungenerated past year isn't "closed," it's just unknown. */
export async function assertFiscalYearOpen(tenantId: string, dateIso: string) {
  const fy = await getFiscalYearByDate(tenantId, dateIso);
  if (fy && fy.status === "closed") {
    throw new Error(`This date falls in fiscal year ${fy.code}, which is closed — reopen it first to post here`);
  }
}

/**
 * The fiscal_year_id to stamp on a journal entry being posted for `dateIso`. Auto-creates the current
 * fiscal year when the date is today and none exists yet (same self-healing behavior as
 * getCurrentFiscalYear), so an ordinary same-day transaction on a fresh tenant still gets one. Never
 * auto-creates a year for a backdated or future date on the fly — that stays null (unknown), the same
 * "don't invent a year nobody configured" rule assertFiscalYearOpen already follows.
 */
export async function resolveFiscalYearId(tenantId: string, dateIso: string): Promise<string | null> {
  const fy = await getFiscalYearByDate(tenantId, dateIso);
  if (fy) return fy.id;
  if (dateIso === todayIso()) return (await getCurrentFiscalYear(tenantId)).id;
  return null;
}

const round = (n: number) => Math.round(n);
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

/** Adds a new fiscal year row — the org's next year, or a past one being backfilled. Rejects a date
 * range that overlaps one already on record, so a date always maps to exactly one fiscal year. */
export async function createFiscalYear(tenantId: string, input: { code: string; startDate: string; endDate: string }) {
  if (!input.code.trim()) throw new Error("Fiscal year code is required");
  if (input.startDate > input.endDate) throw new Error("Start date must be before end date");

  const existing = await listFiscalYears(tenantId);
  if (existing.some((fy) => overlaps(fy.startDate, fy.endDate, input.startDate, input.endDate))) {
    throw new Error("This date range overlaps a fiscal year already on record");
  }

  const [created] = await db.insert(fiscalYears).values({ tenantId, code: input.code.trim(), startDate: input.startDate, endDate: input.endDate, status: "open" }).returning();
  const today = todayIso();
  if (created.startDate <= today && today <= created.endDate) await syncTenantFiscalYearCache(tenantId, created);
  return created;
}

/** The next Nepal BS fiscal year after the most recent one on record (or after today, if none exist) —
 * a suggested starting point for "add the next fiscal year," not something the user has to compute by hand. */
export function suggestNextFiscalYear(lastStartDate: string | null): (DateRange & { code: string }) | null {
  const startYear = lastStartDate ? Number(bsFiscalYearOf(lastStartDate)?.startYear ?? NaN) + 1 : bsFiscalYearOf(todayIso())?.startYear;
  if (startYear === undefined || Number.isNaN(startYear)) return null;
  const fy = bsFiscalYearRange(round(startYear));
  return fy ? { from: fy.from, to: fy.to, code: fy.label } : null;
}

// ---------- Global fiscal-year context (the sidebar switcher) ----------

export const activeFiscalYearCookieName = (tenantId: string) => `activeFY_${tenantId}`;

export type ActiveFiscalYear = FiscalYear | { allTime: true };

/**
 * The fiscal year the user has explicitly picked in the sidebar switcher for THIS organization, if any
 * and still valid, else "All Time," else the tenant's current fiscal year — the default accounting
 * context every page can read instead of assuming "today's fiscal year." Scoped per tenant (not one
 * global cookie) since a user can be active in a different organization with a different fiscal year.
 */
export async function getActiveFiscalYear(tenantId: string): Promise<ActiveFiscalYear> {
  const store = await cookies();
  const picked = store.get(activeFiscalYearCookieName(tenantId))?.value;
  if (picked === "all_time") return { allTime: true };
  if (picked) {
    const fy = await getFiscalYearById(tenantId, picked);
    if (fy) return fy;
  }
  return getCurrentFiscalYear(tenantId);
}
