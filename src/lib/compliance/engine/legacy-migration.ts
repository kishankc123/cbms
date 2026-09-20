import { and, eq, isNotNull, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { complianceCalendarItems, complianceCountries, complianceObligations, complianceRequirementTemplates, tenants } from "@/db/schema";
import { isoFromYmd, monthRange, type CalendarSystem } from "@/lib/calendar";
import { parsePeriodLabel } from "./period-label";
import { mapLegacyStatus } from "./status";

const guessCategory = (name: string) => (/vat|tds|tax|excise|withholding/i.test(name) ? "tax" : "statutory");

/**
 * Moves an organization's old calendar items into compliance_obligations.
 *
 * Re-runnable and non-destructive: every migrated row remembers its source
 * (`legacy_item_id`, unique), and the old table is left in place untouched as
 * an archive. Items that match a template's month (same calendar) take that
 * template's period identity so the generator does not create them again; a
 * matching generated row that has not been worked on absorbs the old item's
 * status instead of being duplicated.
 */
export async function migrateLegacyCalendarItems(tenantId: string): Promise<{ migrated: number; merged: number; skipped: number }> {
  const legacy = await db.select().from(complianceCalendarItems).where(eq(complianceCalendarItems.tenantId, tenantId));
  if (legacy.length === 0) return { migrated: 0, merged: 0, skipped: 0 };

  const already = new Set(
    (await db.select({ id: complianceObligations.legacyItemId }).from(complianceObligations).where(eq(complianceObligations.tenantId, tenantId))).map((r) => r.id).filter(Boolean)
  );

  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [country] = await db.select().from(complianceCountries).where(eq(complianceCountries.code, tenant.countryCode)).limit(1);
  const statutory: CalendarSystem = country?.statutoryCalendar === "BS" ? "BS" : "AD";
  const templates = country ? await db.select().from(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, country.code)) : [];

  let migrated = 0;
  let merged = 0;
  let skipped = 0;

  for (const item of legacy) {
    if (already.has(item.id)) {
      skipped++;
      continue;
    }
    const status = mapLegacyStatus(item.status, Boolean(item.paymentDate));
    const parsed = parsePeriodLabel(item.period);
    const template = templates.find((t) => t.name.toLowerCase() === item.name.trim().toLowerCase() && t.frequency === "monthly");

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let periodKey: string | null = null;
    if (parsed) {
      const first = isoFromYmd(parsed.calendar, { year: parsed.year, month: parsed.month, day: 1 });
      if (first) {
        const r = monthRange(parsed.calendar, first);
        periodStart = r.from;
        periodEnd = r.to;
        // Only a month counted in the template's own calendar has the same identity as a generated one.
        if (template && parsed.calendar === statutory) periodKey = `M:${parsed.calendar}:${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
      }
    }

    const carried = {
      status,
      filingDate: item.submissionDate,
      paymentDate: item.paymentDate,
      amountDue: item.amount,
      supportingDocument: item.supportingDocument,
      notes: item.notes,
      responsibleUserId: item.responsibleUserId,
      legacyItemId: item.id,
      updatedAt: new Date(),
    };

    if (template && periodKey) {
      const [existing] = await db
        .select()
        .from(complianceObligations)
        .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.templateId, template.id), eq(complianceObligations.periodKey, periodKey)))
        .limit(1);
      if (existing) {
        // A generated row nobody has touched takes over the old item's progress; otherwise keep the newer work.
        if (existing.status === "pending" && !existing.legacyItemId) {
          await db.update(complianceObligations).set({ ...carried, dueDate: item.dueDate }).where(eq(complianceObligations.id, existing.id));
          merged++;
        } else skipped++;
        continue;
      }
    }

    await db.insert(complianceObligations).values({
      tenantId,
      templateId: template && periodKey ? template.id : null,
      source: "migrated",
      name: item.name,
      categoryKey: template?.categoryKey ?? guessCategory(item.name),
      taxTypeKey: template?.taxTypeKey ?? null,
      frequency: template?.frequency ?? null,
      periodKey: template && periodKey ? periodKey : null,
      periodLabel: item.period,
      periodStart,
      periodEnd,
      dueDate: item.dueDate,
      paymentDueDate: template?.categoryKey === "tax" ? item.dueDate : null,
      createdAt: item.createdAt,
      ...carried,
    });
    migrated++;
  }
  await supersedeSeededDefaults(tenantId);
  return { migrated, merged, skipped };
}

// The old "Seed Nepal defaults" button filled every organization with AD-month VAT/TDS
// items. Where one of those was never worked on and could not be matched to a generated
// (BS-month) item, it is marked not applicable — with a reason, never deleted — so the
// calendar does not show the same filing twice. Anything anyone touched is left alone.
async function supersedeSeededDefaults(tenantId: string) {
  await db
    .update(complianceObligations)
    .set({
      status: "not_applicable",
      notApplicableReason: "Superseded: the calendar now follows the statutory (BS) months generated from your compliance requirements.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.source, "migrated"),
        eq(complianceObligations.status, "pending"),
        isNull(complianceObligations.templateId),
        isNotNull(complianceObligations.taxTypeKey),
        like(complianceObligations.notes, "Auto-generated default%")
      )
    );
}
