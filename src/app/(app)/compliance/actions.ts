"use server";

import { revalidatePath } from "next/cache";
import { and, eq, asc, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceObligations,
  complianceExceptions,
  complianceCountries,
  complianceEntityTypes,
  tenants,
  auditLog,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { listOrgUsers } from "@/lib/org-users";
import { generateObligations } from "@/lib/compliance/engine/generate";
import { migrateLegacyCalendarItems } from "@/lib/compliance/engine/legacy-migration";
import { effectiveStatus, summarize, type ObligationStatus } from "@/lib/compliance/engine/status";
import { ensureTaxPayableStructure } from "@/lib/compliance/tax-accounts";
import {
  getSalesRegister,
  getPurchaseRegister,
  getVatReturn,
  getTdsReport,
  getTdsPayableBalance,
  getVatPayableBalance,
  getTaxPaymentReport,
  getMonthlyComplianceReport,
  type ComplianceReportType,
} from "@/lib/compliance/reports";

import { todayIso, monthRange } from "@/lib/calendar";
import { validateADDate } from "@/lib/calendar";
async function logAudit(input: {
  tenantId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}) {
  await db.insert(auditLog).values({
    tenantId: input.tenantId,
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeValue: input.before ?? null,
    afterValue: input.after ?? null,
  });
}

// ---------- Compliance framework upkeep ----------

// Brings an organization's compliance data up to date. Every step is idempotent
// and non-destructive (see each function), so it is safe on every visit:
//  1. adopt the existing tax payable accounts into the Taxes Payable group,
//  2. carry over items from the old calendar table,
//  3. generate the obligations the requirement templates say are owed.
// A failure here must never stop the page from loading.
async function ensureCompliance(tenantId: string) {
  try {
    await ensureTaxPayableStructure(tenantId);
    await migrateLegacyCalendarItems(tenantId);
    await generateObligations(tenantId);
  } catch (e) {
    console.error("compliance upkeep failed", e);
  }
}

// ---------- Dashboard ----------

export async function getComplianceDashboard() {
  const session = await requireTenantSession();
  const today = todayIso();
  await ensureCompliance(session.tenantId);

  const obligations = await db
    .select()
    .from(complianceObligations)
    .where(eq(complianceObligations.tenantId, session.tenantId))
    .orderBy(asc(complianceObligations.dueDate));

  const openExceptions = await db
    .select({ id: complianceExceptions.id })
    .from(complianceExceptions)
    .where(and(eq(complianceExceptions.tenantId, session.tenantId), ne(complianceExceptions.status, "closed")));

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const [country] = await db.select({ name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.code, tenant.countryCode)).limit(1);
  const [entityType] = tenant.entityType
    ? await db
        .select({ name: complianceEntityTypes.name })
        .from(complianceEntityTypes)
        .where(and(eq(complianceEntityTypes.countryCode, tenant.countryCode), eq(complianceEntityTypes.key, tenant.entityType)))
        .limit(1)
    : [];

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));
  const counts = summarize(obligations, today);

  // Per-category "what needs attention": open items, and how many of those are overdue.
  const open = obligations.filter((i) => i.status !== "not_applicable" && i.status !== "filed" && i.status !== "paid");
  const byCategory = (keys: string[]) => {
    const items = open.filter((i) => keys.includes(i.categoryKey));
    return { pending: items.length, overdue: items.filter((i) => i.dueDate < today).length };
  };

  // This month's activity, folded in here rather than a separate Reports page — informational, and never what
  // decides a compliance deadline (that always comes from the obligations above).
  const thisMonthRange = monthRange("AD", today);
  const thisMonth = await getMonthlyComplianceReport(session.tenantId, thisMonthRange.from, thisMonthRange.to);

  return {
    company: { name: tenant.companyName, country: country?.name ?? tenant.countryCode, entityType: entityType?.name ?? null },
    summary: { due: counts.dueSoon, upcoming: counts.upcoming, completed: counts.completed, overdue: counts.overdue, exceptions: openExceptions.length },
    categories: [
      { key: "tax", name: "Tax Compliance", href: "/compliance/tax", ...byCategory(["tax"]) },
      { key: "statutory", name: "Statutory Compliance", href: "/compliance/statutory", ...byCategory(["statutory", "ownership", "company"]) },
    ],
    upcoming: open.slice(0, 8).map((i) => ({
      id: i.id,
      name: i.name,
      period: i.periodLabel,
      dueDate: i.dueDate,
      status: effectiveStatus(i, today),
      href: i.categoryKey === "tax" ? "/compliance/tax" : "/compliance/statutory",
      responsibleUserName: i.responsibleUserId ? nameById[i.responsibleUserId] ?? "—" : "—",
    })),
    thisMonth: {
      salesTotal: thisMonth.salesTotal,
      purchasesTotal: thisMonth.purchasesTotal,
      vatPayable: thisMonth.vatReturn.netVatPayable,
      tdsWithheld: thisMonth.tds.totalTds,
      vatOutstanding: thisMonth.vatPayableBalance,
      tdsOutstanding: thisMonth.tdsPayableBalance,
    },
  };
}

// ---------- Compliance Calendar (obligations) ----------

export async function listAssignableUsers() {
  const session = await requireTenantSession();
  return listOrgUsers(session.tenantId);
}

export async function listCalendarItems() {
  const session = await requireTenantSession();
  const today = todayIso();
  await ensureCompliance(session.tenantId);

  const rows = await db
    .select()
    .from(complianceObligations)
    .where(eq(complianceObligations.tenantId, session.tenantId))
    .orderBy(asc(complianceObligations.dueDate));

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    categoryKey: r.categoryKey,
    period: r.periodLabel,
    dueDate: r.dueDate,
    status: r.status as ObligationStatus,
    isOverdue: effectiveStatus(r, today) === "overdue",
    source: r.source,
    amount: r.amountDue,
    notApplicableReason: r.notApplicableReason,
    responsibleUserName: r.responsibleUserId ? nameById[r.responsibleUserId] ?? "—" : "—",
  }));
}

export type CalendarItemInput = {
  name: string;
  categoryKey: string;
  period: string;
  dueDate: string;
  responsibleUserId: string | null;
  amount: number | null;
  notes: string;
};

export async function createCalendarItem(input: CalendarItemInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  if (!input.name.trim()) throw new Error("Name is required");
  if (!validateADDate(input.dueDate)) throw new Error("Due date is required");

  const [created] = await db
    .insert(complianceObligations)
    .values({
      tenantId: session.tenantId,
      source: "manual",
      name: input.name.trim(),
      categoryKey: input.categoryKey || "statutory",
      periodLabel: input.period.trim() || "—",
      dueDate: input.dueDate,
      responsibleUserId: input.responsibleUserId,
      amountDue: input.amount !== null ? input.amount.toFixed(2) : null,
      notes: input.notes.trim() || null,
    })
    .returning({ id: complianceObligations.id });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "compliance_item_created", entityType: "compliance_obligation", entityId: created.id, after: { name: input.name, dueDate: input.dueDate } });
  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
}

export async function updateCalendarItemStatus(input: { itemId: string; status: ObligationStatus; reason?: string }) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");

  const [item] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, input.itemId), eq(complianceObligations.tenantId, session.tenantId)))
    .limit(1);
  if (!item) throw new Error("Compliance item not found");

  // A requirement is never deleted to make it go away: it is marked not applicable, with a reason.
  if (input.status === "not_applicable" && !input.reason?.trim()) throw new Error("A reason is required to mark an item not applicable");

  const today = todayIso();
  await db
    .update(complianceObligations)
    .set({
      status: input.status,
      notApplicableReason: input.status === "not_applicable" ? input.reason!.trim() : null,
      // Record when it was filed/paid the first time it reaches that state.
      filingDate: input.status === "filed" || input.status === "paid" ? item.filingDate ?? today : item.filingDate,
      paymentDate: input.status === "paid" ? item.paymentDate ?? today : item.paymentDate,
      updatedAt: new Date(),
    })
    .where(eq(complianceObligations.id, item.id));

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "compliance_status_changed",
    entityType: "compliance_obligation",
    entityId: item.id,
    before: { status: item.status },
    after: { status: input.status, reason: input.reason ?? null },
  });
  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
}

export async function deleteCalendarItem(itemId: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "delete")) throw new Error("Not permitted");

  const [item] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, itemId), eq(complianceObligations.tenantId, session.tenantId)))
    .limit(1);
  if (!item) throw new Error("Compliance item not found");
  if (item.source !== "manual" || item.status !== "pending") {
    throw new Error("Only an untouched manual item can be deleted. Mark this one Not applicable instead.");
  }

  await db.delete(complianceObligations).where(eq(complianceObligations.id, item.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "compliance_item_deleted", entityType: "compliance_obligation", entityId: item.id, before: { name: item.name, dueDate: item.dueDate } });
  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
}

// Runs the requirement engine on demand and reports how many new items it created.
export async function generateComplianceItems() {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  const created = await generateObligations(session.tenantId);
  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
  return created;
}

// ---------- Reports ----------

export async function generateReport(input: { type: ComplianceReportType; from: string; to: string }) {
  const session = await requireTenantSession();
  switch (input.type) {
    case "sales_register":
      return getSalesRegister(session.tenantId, input.from, input.to);
    case "purchase_register":
      return getPurchaseRegister(session.tenantId, input.from, input.to);
    case "vat_return":
      return getVatReturn(session.tenantId, input.from, input.to);
    case "tds_report":
      return getTdsReport(session.tenantId, input.from, input.to);
    case "tds_payable":
      return { balance: await getTdsPayableBalance(session.tenantId) };
    case "tax_payment_report":
      return getTaxPaymentReport(session.tenantId, input.from, input.to);
    case "monthly_compliance_report":
      return getMonthlyComplianceReport(session.tenantId, input.from, input.to);
    default:
      throw new Error("Unknown report type");
  }
}

