import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { complianceObligations, compliancePenaltyRules, exciseRenewals, tenantTaxRegistrations, tenants } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { bsFiscalYearOf, bsFiscalYearRange, todayIso, validateADDate, type IsoDate } from "@/lib/calendar";
import { permitStatus, shrawanDeadline, type PermitStatus } from "./excise-permit-rules";
import type { PermitRenewalParams } from "./penalty-types";

// The excise permit of an organization: its status for today, the renewals recorded, and the renewal obligation that shows up
// in Tax Compliance. Plain server helpers, not server actions: the actions in compliance/excise-actions check the permission.

export type Renewal = { id: string; fiscalYear: string; fiscalYearStart: IsoDate; paidDate: IsoDate; feeAmount: number; penaltyAmount: number; receiptReference: string | null; notes: string | null };

export type Permit = {
  registrationId: string;
  permitNumber: string | null;
  permitDate: IsoDate;
  standardFee: number | null;
  renewals: Renewal[];
  status: PermitStatus;
  /** Whether the late-renewal bands are verified against current law (shown beside the fine). */
  ruleVerified: boolean | null;
};

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const round2 = (n: number) => Math.round(n * 100) / 100;

async function ruleOn(countryCode: string, date: IsoDate): Promise<{ params: PermitRenewalParams; verified: boolean } | null> {
  const [row] = await db
    .select()
    .from(compliancePenaltyRules)
    .where(and(eq(compliancePenaltyRules.countryCode, countryCode), eq(compliancePenaltyRules.taxTypeKey, "excise_permit"), lte(compliancePenaltyRules.effectiveFrom, date), or(isNull(compliancePenaltyRules.effectiveTo), gte(compliancePenaltyRules.effectiveTo, date))))
    .limit(1);
  const params = row?.params as PermitRenewalParams | undefined;
  return row && params && Array.isArray(params.tiers) ? { params, verified: row.isVerified } : null;
}

/** The organization's excise permit as of `today`, or null when it has no active excise registration with a permit date. */
export async function loadPermit(tenantId: string, today: IsoDate = todayIso()): Promise<Permit | null> {
  const [reg] = await db
    .select()
    .from(tenantTaxRegistrations)
    .where(and(eq(tenantTaxRegistrations.tenantId, tenantId), eq(tenantTaxRegistrations.taxTypeKey, "excise"), eq(tenantTaxRegistrations.status, "active")))
    .limit(1);
  if (!reg?.effectiveDate) return null;
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  const rows = await db.select().from(exciseRenewals).where(eq(exciseRenewals.tenantId, tenantId)).orderBy(asc(exciseRenewals.fiscalYearStart));
  const renewals: Renewal[] = rows.map((r) => ({ id: r.id, fiscalYear: bsFiscalYearOf(r.fiscalYearStart)?.label ?? r.fiscalYearStart, fiscalYearStart: r.fiscalYearStart, paidDate: r.paidDate, feeAmount: Number(r.feeAmount), penaltyAmount: Number(r.penaltyAmount), receiptReference: r.receiptReference, notes: r.notes }));
  const renewedYears = rows.map((r) => bsFiscalYearOf(r.fiscalYearStart)?.startYear).filter((y): y is number => typeof y === "number");
  const standardFee = reg.standardRenewalFee === null ? null : Number(reg.standardRenewalFee);

  // The bands in force on the deadline of the renewal that is due decide the fine: find the deadline first, then the bands.
  const first = permitStatus({ today, permitDate: reg.effectiveDate, renewedYears, standardFee, rule: null });
  if (!first) return null;
  const rule = await ruleOn(tenant?.countryCode ?? "NP", first.renewalFor.deadline);
  const status = permitStatus({ today, permitDate: reg.effectiveDate, renewedYears, standardFee, rule: rule?.params ?? null })!;
  return { registrationId: reg.id, permitNumber: reg.registrationNumber, permitDate: reg.effectiveDate, standardFee, renewals, status, ruleVerified: rule ? rule.verified : null };
}

export async function setStandardRenewalFee(tenantId: string, userId: string, fee: number | null): Promise<Result> {
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) return fail("Enter the fee as a number that is not negative.");
  const [reg] = await db
    .select()
    .from(tenantTaxRegistrations)
    .where(and(eq(tenantTaxRegistrations.tenantId, tenantId), eq(tenantTaxRegistrations.taxTypeKey, "excise"), eq(tenantTaxRegistrations.status, "active")))
    .limit(1);
  if (!reg) return fail("There is no active excise registration.");
  await db.update(tenantTaxRegistrations).set({ standardRenewalFee: fee === null ? null : round2(fee).toFixed(2), updatedAt: new Date() }).where(eq(tenantTaxRegistrations.id, reg.id));
  await logAuditEvent({ tenantId, userId, action: "excise_renewal_fee_set", entityType: "tax_registration", entityId: reg.id, before: { fee: reg.standardRenewalFee }, after: { fee } });
  return { ok: true };
}

const periodKeyOf = (fyFrom: IsoDate) => `FY:${fyFrom}`;

/** The renewal item in Tax Compliance for a fiscal year, created if missing. */
async function renewalObligation(tenantId: string, startYear: number) {
  const range = bsFiscalYearRange(startYear);
  if (!range) return null;
  const key = periodKeyOf(range.from);
  const [existing] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.taxTypeKey, "excise"), eq(complianceObligations.periodKey, key), isNull(complianceObligations.templateId)))
    .limit(1);
  if (existing) return existing;
  const deadline = shrawanDeadline(startYear);
  const [created] = await db
    .insert(complianceObligations)
    .values({ tenantId, source: "generated", name: "Excise Permit Renewal", categoryKey: "tax", taxTypeKey: "excise", frequency: "annual", periodKey: key, periodLabel: `Renewal for FY ${range.label}`, periodStart: range.from, periodEnd: deadline, dueDate: deadline, paymentDueDate: deadline })
    .returning();
  return created;
}

/**
 * Makes sure there is a renewal item for every fiscal year that is due or overdue, so it shows in Tax Compliance, the calendar
 * and the overview; and that a year already renewed shows as paid. Idempotent. Returns how many were created.
 */
export async function ensureRenewalObligations(tenantId: string, today: IsoDate = todayIso()): Promise<number> {
  const permit = await loadPermit(tenantId, today);
  if (!permit) return 0;
  let created = 0;
  for (const y of permit.status.unpaidYears) {
    const range = bsFiscalYearRange(y);
    if (!range) continue;
    const had = await db.select({ id: complianceObligations.id }).from(complianceObligations).where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.taxTypeKey, "excise"), eq(complianceObligations.periodKey, periodKeyOf(range.from)), isNull(complianceObligations.templateId))).limit(1);
    await renewalObligation(tenantId, y);
    if (had.length === 0) created++;
  }
  return created;
}

export type RenewalInput = { fiscalYearStart: number; paidDate: IsoDate; feeAmount: number; penaltyAmount: number; receiptReference: string; notes: string };

/** Records that the permit was renewed for the next unpaid fiscal year. Years are renewed in order, oldest first. */
export async function recordRenewal(tenantId: string, userId: string, input: RenewalInput, today: IsoDate = todayIso()): Promise<Result> {
  const permit = await loadPermit(tenantId, today);
  if (!permit) return fail("There is no active excise permit with a permit date.");
  const next = permit.status.unpaidYears[0];
  if (next === undefined) return fail("The permit is already paid up for the current fiscal year.");
  if (input.fiscalYearStart !== next) return fail(`Renewals are recorded in order. The next one due is for fiscal year ${bsFiscalYearRange(next)?.label}.`);
  if (!validateADDate(input.paidDate)) return fail("Enter the date the fee was paid.");
  if (input.paidDate > today) return fail("The payment date can't be in the future.");
  const range = bsFiscalYearRange(next)!;
  if (input.paidDate < addDaysSafe(range.from, -366)) return fail("That payment date is too long before the fiscal year it renews.");
  for (const [label, v] of [["fee", input.feeAmount], ["fine", input.penaltyAmount]] as const) if (!Number.isFinite(v) || v < 0) return fail(`Enter the ${label} as a number that is not negative.`);
  if (input.feeAmount <= 0) return fail("Enter the renewal fee that was paid.");

  const [row] = await db
    .insert(exciseRenewals)
    .values({ tenantId, fiscalYearStart: range.from, paidDate: input.paidDate, feeAmount: round2(input.feeAmount).toFixed(2), penaltyAmount: round2(input.penaltyAmount).toFixed(2), receiptReference: input.receiptReference.trim() || null, notes: input.notes.trim() || null, createdBy: userId })
    .returning({ id: exciseRenewals.id });

  const ob = await renewalObligation(tenantId, next);
  if (ob) await db.update(complianceObligations).set({ status: "paid", filingDate: input.paidDate, paymentDate: input.paidDate, amountDue: round2(input.feeAmount + input.penaltyAmount).toFixed(2), paymentReference: input.receiptReference.trim() || null, updatedAt: new Date() }).where(eq(complianceObligations.id, ob.id));
  await logAuditEvent({ tenantId, userId, action: "excise_renewal_recorded", entityType: "excise_renewal", entityId: row.id, after: { fiscalYear: range.label, paidDate: input.paidDate, fee: input.feeAmount, penalty: input.penaltyAmount, receipt: input.receiptReference.trim() || null } });
  await ensureRenewalObligations(tenantId, today);
  return { ok: true };
}

/** Takes back the latest renewal (a wrong entry); its fiscal year becomes due again. */
export async function undoLatestRenewal(tenantId: string, userId: string, today: IsoDate = todayIso()): Promise<Result> {
  const [latest] = await db.select().from(exciseRenewals).where(eq(exciseRenewals.tenantId, tenantId)).orderBy(desc(exciseRenewals.fiscalYearStart)).limit(1);
  if (!latest) return fail("There is no renewal to take back.");
  await db.delete(exciseRenewals).where(eq(exciseRenewals.id, latest.id));
  await db
    .update(complianceObligations)
    .set({ status: "pending", filingDate: null, paymentDate: null, amountDue: null, paymentReference: null, updatedAt: new Date() })
    .where(and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.taxTypeKey, "excise"), eq(complianceObligations.periodKey, periodKeyOf(latest.fiscalYearStart)), isNull(complianceObligations.templateId)));
  await logAuditEvent({ tenantId, userId, action: "excise_renewal_undone", entityType: "excise_renewal", entityId: latest.id, before: { fiscalYearStart: latest.fiscalYearStart, paidDate: latest.paidDate, fee: latest.feeAmount, penalty: latest.penaltyAmount } });
  await ensureRenewalObligations(tenantId, today);
  return { ok: true };
}

function addDaysSafe(iso: IsoDate, days: number): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
