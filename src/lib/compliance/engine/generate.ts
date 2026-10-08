import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, complianceObligations, complianceRequirementTemplates, tenants } from "@/db/schema";
import { todayIso, type CalendarSystem, type DateRange, type IsoDate } from "@/lib/calendar";
import { computeFiscalYearRangeFor } from "@/lib/fiscal";
import { isApplicable } from "./applicability";
import { eventPeriod } from "./events";
import { assertValidDueRule, computeDueDate, periodsFor, type DueRule } from "./due-rules";
import { loadFacts } from "./facts";
import { loadComplianceProfile } from "../profile";
import { afterFloor, startFloor } from "./start-dates";

type Template = typeof complianceRequirementTemplates.$inferSelect;

function resolveCalendar(template: Template, statutory: CalendarSystem, org: CalendarSystem): CalendarSystem {
  switch (template.periodCalendar) {
    case "org":
      return org;
    case "AD":
    case "BS":
      return template.periodCalendar;
    default:
      return statutory;
  }
}

/** Is the template usable for this organization on this date (entity type, active window, has something to schedule)? */
export function templateInScope(t: Template, entityType: string | null, today: IsoDate): boolean {
  if (!t.isActive || t.frequency === "event_based" || !t.dueRule) return false;
  if (t.entityTypeKey && t.entityTypeKey !== entityType) return false;
  if (t.activeFrom && t.activeFrom > today) return false;
  if (t.activeTo && t.activeTo < today) return false;
  return true;
}

/**
 * Creates the compliance obligations this organization currently owes:
 *
 *   country -> entity type -> applicable templates -> one row per period.
 *
 * Nothing is created until the company profile is complete (see profile.ts): a deadline worked out from missing facts
 * would be a guess. Recurring items cover every period from the start of the current fiscal year (Shrawan 1) through
 * the next two, plus the previous period, so a return for the last month of the last year is never lost; and never a period
 * that ended before the thing it belongs to began (VAT before the VAT registration took effect, and so on).
 *
 * Idempotent: (organization, template, period) is unique, so running it again
 * — on every page load, if need be — never duplicates anything, and it never
 * touches a row that already exists (so a filed return's due date can't move
 * when a rule is later edited). Nothing is ever deleted here; requirements
 * that stop applying are marked "not applicable" by a person, not removed.
 *
 * Returns how many new obligations were created.
 */
export async function generateObligations(
  tenantId: string,
  opts: { today?: IsoDate; monthsBack?: number; monthsAhead?: number } = {}
): Promise<number> {
  const today = opts.today ?? todayIso();
  const back = opts.monthsBack ?? 1;
  const ahead = opts.monthsAhead ?? 2;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");

  const [country] = await db.select().from(complianceCountries).where(and(eq(complianceCountries.code, tenant.countryCode), eq(complianceCountries.isActive, true))).limit(1);
  if (!country) return 0; // country not configured/activated: nothing to generate

  const orgCalendar: CalendarSystem = tenant.calendarSystem === "BS" ? "BS" : "AD";
  const statutory: CalendarSystem = country.statutoryCalendar === "BS" ? "BS" : "AD";
  // Always a real range — Nepal's own statutory fiscal year (Shrawan-Ashadh) when the cached
  // start/end pair isn't current, the same computation src/lib/fiscal.ts uses for the dashboard and
  // reports, so a quarter's or fiscal year's due date never drifts from what the rest of the app
  // considers "the current fiscal year."
  const fiscal: DateRange = computeFiscalYearRangeFor(
    { countryCode: tenant.countryCode, calendarSystem: tenant.calendarSystem, fiscalYearStartDate: tenant.fiscalYearStartDate, fiscalYearEndDate: tenant.fiscalYearEndDate, fiscalYearLabel: tenant.fiscalYearLabel },
    today
  );

  const profile = await loadComplianceProfile(tenantId);
  if (!profile.complete) return 0; // the profile gate: no compliance until the company details are filled in

  const facts = await loadFacts(tenant);
  const templates = (await db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, country.code))).filter(
    (t) => templateInScope(t, tenant.entityType, today) && isApplicable(t.applicability, facts)
  );

  const rows: (typeof complianceObligations.$inferInsert)[] = [];
  for (const t of templates) {
    assertValidDueRule(t.dueRule);
    const rule = t.dueRule as DueRule;
    if (rule.period === "event") continue; // raised by the event itself, not scheduled
    const calendar = resolveCalendar(t, statutory, orgCalendar);
    const ctx = { calendar, today, fiscal };
    let periods = periodsFor(rule.period, ctx, rule.period === "fiscal_year" ? 1 : back, ahead);
    if (rule.period === "month" || rule.period === "quarter" || rule.period === "term") {
      // Everything since the start of the current fiscal year as well as the usual window around today.
      const seen = new Set(periods.map((p) => p.key));
      for (const p of periodsFor(rule.period, ctx, 12, ahead)) if (p.end >= fiscal.from && !seen.has(p.key)) periods.push(p);
      periods.sort((a, b) => (a.start < b.start ? -1 : 1));
    }
    const floor = startFloor(t.taxTypeKey, profile.starts);
    periods = periods.filter((p) => afterFloor(p, floor));
    for (const p of periods) {
      const due = computeDueDate(rule, p, calendar);
      rows.push({
        tenantId,
        templateId: t.id,
        source: "generated",
        name: t.name,
        categoryKey: t.categoryKey,
        taxTypeKey: t.taxTypeKey,
        frequency: t.frequency,
        periodKey: p.key,
        periodLabel: p.label,
        periodStart: p.start,
        periodEnd: p.end,
        dueDate: due,
        // Tax returns are filed and paid against the same deadline unless changed by hand.
        paymentDueDate: t.categoryKey === "tax" ? due : null,
      });
    }
  }
  if (rows.length === 0) return 0;

  const inserted = await db.insert(complianceObligations).values(rows).onConflictDoNothing().returning({ id: complianceObligations.id });
  return inserted.length;
}

/**
 * Raises the obligation for something that just happened (e.g. Share Lagat must be
 * updated after a shareholder change), from an event-based requirement template.
 * It only does anything if the template is ACTIVE for this organization and has a
 * due-date rule — the deadline comes from configuration a reviewer has confirmed,
 * never from a guess. Returns whether an obligation was created.
 */
export async function raiseEventObligation(tenantId: string, templateKey: string, event: { key: string; label: string; date: IsoDate }): Promise<boolean> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return false;
  const [country] = await db.select().from(complianceCountries).where(and(eq(complianceCountries.code, tenant.countryCode), eq(complianceCountries.isActive, true))).limit(1);
  if (!country) return false;

  const [t] = await db
    .select()
    .from(complianceRequirementTemplates)
    .where(and(eq(complianceRequirementTemplates.countryCode, country.code), eq(complianceRequirementTemplates.key, templateKey)))
    .limit(1);
  if (!t || !t.isActive || !t.dueRule) return false;
  if (t.entityTypeKey && t.entityTypeKey !== tenant.entityType) return false;
  if (!isApplicable(t.applicability, await loadFacts(tenant))) return false;

  assertValidDueRule(t.dueRule);
  const rule = t.dueRule as DueRule;
  if (rule.period !== "event") return false;

  const orgCalendar: CalendarSystem = tenant.calendarSystem === "BS" ? "BS" : "AD";
  const statutory: CalendarSystem = country.statutoryCalendar === "BS" ? "BS" : "AD";
  const calendar = resolveCalendar(t, statutory, orgCalendar);
  const period = eventPeriod(event.key, event.label, event.date);

  const inserted = await db
    .insert(complianceObligations)
    .values({
      tenantId,
      templateId: t.id,
      source: "generated",
      name: t.name,
      categoryKey: t.categoryKey,
      taxTypeKey: t.taxTypeKey,
      frequency: t.frequency,
      periodKey: period.key,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      dueDate: computeDueDate(rule, period, calendar),
    })
    .onConflictDoNothing()
    .returning({ id: complianceObligations.id });
  return inserted.length > 0;
}
