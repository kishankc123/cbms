import { cookies } from "next/headers";
import { and, desc, eq, lte, gte } from "drizzle-orm";
import { db } from "@/db";
import { tenants, fiscalYears, type FiscalYearStatus } from "@/db/schema";
import { bsFiscalYearOf, bsFiscalYearRange, yearRange, todayIso, presetRange } from "@/lib/calendar";
import type { DateRange, CalendarSystem } from "@/lib/calendar";

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

type TenantFiscalFields = {
  countryCode: string;
  calendarSystem: string;
  fiscalYearStartDate: string | null;
  fiscalYearEndDate: string | null;
  fiscalYearLabel: string | null;
};

/**
 * What the current fiscal year WOULD be for this tenant, on `today` — a pure computation, never a
 * database write. Nepal's statutory fiscal year is always Shrawan 1 – Ashadh end (in real AD dates,
 * via the calendar engine's own BS<->AD table), regardless of whether the organization's own display
 * calendar is set to AD or BS — `calendarSystem` only changes how dates are shown, never what period
 * the fiscal year actually covers. Non-Nepal tenants (a country other than "NP") keep the older
 * calendar-year-or-BS-if-set fallback, since nothing else in this app supports another country's
 * fiscal-year rule yet.
 */
export function computeFiscalYearRangeFor(tenant: TenantFiscalFields, today: string): DateRange & { code: string } {
  // The cached start/end pair, when it's still current, is honored first — this reflects a fiscal
  // year that was just added or changed immediately, without a second lookup.
  if (tenant.fiscalYearStartDate && tenant.fiscalYearEndDate && tenant.fiscalYearStartDate <= today && today <= tenant.fiscalYearEndDate) {
    return { from: tenant.fiscalYearStartDate, to: tenant.fiscalYearEndDate, code: tenant.fiscalYearLabel || tenant.fiscalYearStartDate.slice(0, 4) };
  }
  if (tenant.countryCode === "NP" || tenant.calendarSystem === "BS") {
    const fy = bsFiscalYearOf(today);
    if (fy) return { from: fy.from, to: fy.to, code: fy.label };
  }
  const y = yearRange("AD", today);
  return { from: y.from, to: y.to, code: y.from.slice(0, 4) };
}

export type SuggestedFiscalYear = { suggested: true; code: string; startDate: string; endDate: string };

/**
 * The current fiscal year: a REAL row if one is already on record for today, else a computed
 * SUGGESTION only. This never writes to the database — fiscal years are never auto-created; the
 * user always explicitly adds one via Settings → Fiscal Years. Callers that need to tell the two
 * apart check `"suggested" in fy`.
 */
export async function getCurrentFiscalYear(tenantId: string): Promise<FiscalYear | SuggestedFiscalYear> {
  const today = todayIso();
  const existing = await getFiscalYearByDate(tenantId, today);
  if (existing) return existing;

  const [tenant] = await db
    .select({ countryCode: tenants.countryCode, calendarSystem: tenants.calendarSystem, fiscalYearStartDate: tenants.fiscalYearStartDate, fiscalYearEndDate: tenants.fiscalYearEndDate, fiscalYearLabel: tenants.fiscalYearLabel })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const range = computeFiscalYearRangeFor(tenant ?? { countryCode: "NP", calendarSystem: "AD", fiscalYearStartDate: null, fiscalYearEndDate: null, fiscalYearLabel: null }, today);
  return { suggested: true, code: range.code, startDate: range.from, endDate: range.to };
}

/** Keeps `tenants.fiscalYearLabel/StartDate/EndDate` — read by older display call sites and by the
 * compliance engine's own fiscal-year lookup — in step with whichever fiscal year is actually
 * current, so nothing needs to be migrated off them individually. */
async function syncTenantFiscalYearCache(tenantId: string, fy: Pick<FiscalYear, "code" | "startDate" | "endDate">) {
  await db.update(tenants).set({ fiscalYearLabel: fy.code, fiscalYearStartDate: fy.startDate, fiscalYearEndDate: fy.endDate }).where(eq(tenants.id, tenantId));
}

/** The organization's current fiscal year as real AD boundaries (independent of AD/BS display) — a
 * real fiscal year's boundaries if one is on record, else the computed suggestion. Never null. */
export async function getFiscalRange(tenantId: string): Promise<DateRange> {
  const fy = await getCurrentFiscalYear(tenantId);
  return { from: fy.startDate, to: fy.endDate };
}

export function isFiscalYearOpen(fy: Pick<FiscalYear, "status">): boolean {
  return fy.status !== "closed";
}

/** Blocks posting/reversing into a closed fiscal year — the fiscal-year-level counterpart to
 * assertPeriodOpen (an arbitrary admin-defined period lock). A date with no fiscal year on record
 * yet is allowed through undecided rather than blocked — fiscal years are never auto-created, so an
 * ungenerated year isn't "closed," it's just not on record yet. */
export async function assertFiscalYearOpen(tenantId: string, dateIso: string) {
  const fy = await getFiscalYearByDate(tenantId, dateIso);
  if (fy && fy.status === "closed") {
    throw new Error(`This date falls in fiscal year ${fy.code}, which is closed — reopen it first to post here`);
  }
}

/**
 * The fiscal_year_id to stamp on a journal entry being posted for `dateIso` — a REAL fiscal year
 * already on record, or null. Never creates one on the fly, even for today's date: fiscal years are
 * only ever created explicitly, via Settings → Fiscal Years. A transaction posted before the
 * organization has added its current fiscal year simply carries no fiscal_year_id until it does.
 */
export async function resolveFiscalYearId(tenantId: string, dateIso: string): Promise<string | null> {
  const fy = await getFiscalYearByDate(tenantId, dateIso);
  return fy ? fy.id : null;
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

/** The earliest BS fiscal-year start year this tenant may add — the year the company's registration
 * date (Compliance → Company Details) falls into, or null if no registration date is on file yet
 * (no floor until then, so a brand-new organization isn't blocked from adding its current year). */
export async function earliestSelectableFiscalYearStartYear(tenantId: string): Promise<number | null> {
  const [tenant] = await db.select({ registrationDate: tenants.registrationDate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant?.registrationDate) return null;
  return bsFiscalYearOf(tenant.registrationDate)?.startYear ?? null;
}

/**
 * Adds a Nepal fiscal year (Shrawan 1 – Ashadh end) by its BS start year — dates and code are always
 * COMPUTED, never supplied by the caller, so every fiscal year in the system has exactly the same
 * boundaries as everyone else's; there is no way to type an arbitrary date range. Rejects a year
 * before the company's registration date, or one that overlaps a fiscal year already on record.
 */
export async function createFiscalYear(tenantId: string, input: { startYear: number }) {
  const fy = bsFiscalYearRange(input.startYear);
  if (!fy) throw new Error("Enter a valid fiscal year");

  const floor = await earliestSelectableFiscalYearStartYear(tenantId);
  if (floor !== null && input.startYear < floor) {
    const floorLabel = bsFiscalYearRange(floor)?.label ?? floor;
    throw new Error(`This organization's registration date falls in fiscal year ${floorLabel} — an earlier fiscal year can't be added`);
  }

  const existing = await listFiscalYears(tenantId);
  if (existing.some((e) => overlaps(e.startDate, e.endDate, fy.from, fy.to))) {
    throw new Error(`Fiscal year ${fy.label} has already been added`);
  }

  const [created] = await db.insert(fiscalYears).values({ tenantId, code: fy.label, startDate: fy.from, endDate: fy.to, status: "open" }).returning();
  const today = todayIso();
  if (created.startDate <= today && today <= created.endDate) await syncTenantFiscalYearCache(tenantId, created);
  return created;
}

// ---------- Global fiscal-year context (the sidebar switcher) ----------

export const activeFiscalYearCookieName = (tenantId: string) => `activeFY_${tenantId}`;

export type ActiveFiscalYear = FiscalYear | SuggestedFiscalYear | { allTime: true };

/**
 * The fiscal year the user has explicitly picked in the sidebar switcher for THIS organization, if any
 * and still valid, else "All Time," else the tenant's current fiscal year (real if on record, else a
 * computed suggestion — see getCurrentFiscalYear) — the default accounting context every page can read
 * instead of assuming "today's fiscal year." Scoped per tenant (not one global cookie) since a user can
 * be active in a different organization with a different fiscal year.
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

/** A period report's default range for the sidebar's active fiscal-year context — that fiscal year's
 * own boundaries, or the calendar engine's All Time floor..today when "All Time" is picked. */
export function fiscalYearDefaultRange(activeFiscalYear: ActiveFiscalYear, calendar: CalendarSystem): DateRange {
  if ("allTime" in activeFiscalYear) return presetRange("all_time", calendar, todayIso());
  return { from: activeFiscalYear.startDate, to: activeFiscalYear.endDate };
}

/** A point-in-time ("as of") report's default date for the active fiscal-year context — today, if today
 * actually falls in the selected fiscal year (or All Time is selected), else that year's own end date,
 * so picking a past, already-closed fiscal year shows its final position rather than a mismatched "today." */
export function fiscalYearDefaultAsOf(activeFiscalYear: ActiveFiscalYear): string {
  const today = todayIso();
  if ("allTime" in activeFiscalYear) return today;
  return activeFiscalYear.startDate <= today && today <= activeFiscalYear.endDate ? today : activeFiscalYear.endDate;
}

/** Convenience wrapper combining getActiveFiscalYear + fiscalYearDefaultRange for a report page's default. */
export async function getReportDefaultRange(tenantId: string, calendar: CalendarSystem): Promise<DateRange> {
  return fiscalYearDefaultRange(await getActiveFiscalYear(tenantId), calendar);
}

/** Convenience wrapper combining getActiveFiscalYear + fiscalYearDefaultAsOf for a report page's default. */
export async function getReportDefaultAsOf(tenantId: string): Promise<string> {
  return fiscalYearDefaultAsOf(await getActiveFiscalYear(tenantId));
}
