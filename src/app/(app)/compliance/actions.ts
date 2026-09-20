"use server";

import { revalidatePath } from "next/cache";
import { and, eq, asc, desc, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  complianceRules,
  complianceExceptions,
  complianceCalendarItems,
  auditLog,
  users,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { listOrgUsers } from "@/lib/org-users";
import { isOrgAdmin } from "@/lib/roles";
import { runComplianceScan } from "@/lib/compliance/exception-scan";
import { generateNepaliDefaultItems } from "@/lib/compliance/nepal-calendar";
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

// ---------- Dashboard ----------

export async function getComplianceDashboard() {
  const session = await requireTenantSession();
  const today = new Date().toISOString().slice(0, 10);

  const calendarItems = await db
    .select()
    .from(complianceCalendarItems)
    .where(eq(complianceCalendarItems.tenantId, session.tenantId))
    .orderBy(asc(complianceCalendarItems.dueDate));

  const openExceptions = await db
    .select({ id: complianceExceptions.id })
    .from(complianceExceptions)
    .where(and(eq(complianceExceptions.tenantId, session.tenantId), ne(complianceExceptions.status, "closed")));

  const done = new Set(["completed", "paid"]);
  const due = calendarItems.filter((i) => !done.has(i.status) && i.dueDate === today).length;
  const upcoming = calendarItems.filter((i) => !done.has(i.status) && i.dueDate > today).length;
  const completed = calendarItems.filter((i) => done.has(i.status)).length;
  const overdue = calendarItems.filter((i) => !done.has(i.status) && i.dueDate < today).length;

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));

  return {
    summary: { due, upcoming, completed, overdue, exceptions: openExceptions.length },
    items: calendarItems.map((i) => ({
      id: i.id,
      name: i.name,
      period: i.period,
      dueDate: i.dueDate,
      status: i.status,
      amount: i.amount ? Number(i.amount) : null,
      responsibleUserName: i.responsibleUserId ? nameById[i.responsibleUserId] ?? "—" : "—",
    })),
  };
}

// ---------- Period locking ----------

export async function listPeriods() {
  const session = await requireTenantSession();
  return db
    .select()
    .from(accountingPeriods)
    .where(eq(accountingPeriods.tenantId, session.tenantId))
    .orderBy(desc(accountingPeriods.periodStart));
}

export async function createPeriod(input: { periodStart: string; periodEnd: string; label: string }) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  if (!input.label.trim()) throw new Error("Label is required");
  if (input.periodStart > input.periodEnd) throw new Error("Period start must be before period end");

  await db.insert(accountingPeriods).values({
    tenantId: session.tenantId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    label: input.label.trim(),
  });

  revalidatePath("/compliance/periods");
}

// Closing a period is available to anyone with edit permission — it's the
// routine month-end action. Reopening is admin-only (see below).
export async function closePeriod(periodId: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");

  const [period] = await db
    .select()
    .from(accountingPeriods)
    .where(and(eq(accountingPeriods.id, periodId), eq(accountingPeriods.tenantId, session.tenantId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  if (period.status === "closed") throw new Error("Period is already closed");

  await db
    .update(accountingPeriods)
    .set({ status: "closed", closedBy: session.userId, closedAt: new Date() })
    .where(eq(accountingPeriods.id, periodId));

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "period_closed",
    entityType: "accounting_period",
    entityId: periodId,
    before: { status: period.status },
    after: { status: "closed" },
  });

  revalidatePath("/compliance/periods");
}

// Admin-only, reason required — no separate approval step, matching the
// same pattern used for reopening a bank reconciliation.
export async function reopenPeriod(input: { periodId: string; reason: string }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an admin can reopen a closed period");
  if (!input.reason.trim()) throw new Error("A reason is required to reopen a period");

  const [period] = await db
    .select()
    .from(accountingPeriods)
    .where(and(eq(accountingPeriods.id, input.periodId), eq(accountingPeriods.tenantId, session.tenantId)))
    .limit(1);
  if (!period) throw new Error("Period not found");
  if (period.status !== "closed") throw new Error("Only a closed period can be reopened");

  await db
    .update(accountingPeriods)
    .set({ status: "reopened", reopenedBy: session.userId, reopenedAt: new Date(), reopenReason: input.reason.trim() })
    .where(eq(accountingPeriods.id, input.periodId));

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "period_reopened",
    entityType: "accounting_period",
    entityId: input.periodId,
    before: { status: "closed" },
    after: { status: "reopened", reason: input.reason.trim() },
  });

  revalidatePath("/compliance/periods");
}

// ---------- Rules & Policies ----------

export async function listRules() {
  const session = await requireTenantSession();
  return db.select().from(complianceRules).where(eq(complianceRules.tenantId, session.tenantId)).orderBy(desc(complianceRules.createdAt));
}

export type RuleInput = {
  name: string;
  category: string;
  description: string;
  applicableModule: "sales" | "purchases" | "expenses" | "payroll" | "bank_reconciliation" | "general";
  checkType:
    | "amount_threshold"
    | "missing_pan"
    | "duplicate_invoice"
    | "closed_period_posting"
    | "bank_unreconciled_days"
    | "negative_balance"
    | "backdated_transaction";
  thresholdValue: number | null;
  severity: "information" | "warning" | "review_required" | "blocking";
  action: "warn" | "block" | "create_exception";
  approvalRequired: boolean;
  effectiveDate: string;
  expiryDate: string;
};

export async function createRule(input: RuleInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  if (!input.name.trim()) throw new Error("Rule name is required");

  const [rule] = await db
    .insert(complianceRules)
    .values({
      tenantId: session.tenantId,
      name: input.name.trim(),
      category: input.category.trim() || null,
      description: input.description.trim() || null,
      applicableModule: input.applicableModule,
      checkType: input.checkType,
      thresholdValue: input.thresholdValue !== null ? input.thresholdValue.toFixed(2) : null,
      severity: input.severity,
      action: input.action,
      approvalRequired: input.approvalRequired,
      effectiveDate: input.effectiveDate || null,
      expiryDate: input.expiryDate || null,
      createdBy: session.userId,
    })
    .returning();

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "rule_created", entityType: "compliance_rule", entityId: rule.id, after: input });
  revalidatePath("/compliance/rules");
}

export async function setRuleActive(input: { ruleId: string; isActive: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");

  await db
    .update(complianceRules)
    .set({ isActive: input.isActive })
    .where(and(eq(complianceRules.id, input.ruleId), eq(complianceRules.tenantId, session.tenantId)));

  revalidatePath("/compliance/rules");
}

export async function deleteRule(ruleId: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "delete")) throw new Error("Not permitted");

  await db.delete(complianceRules).where(and(eq(complianceRules.id, ruleId), eq(complianceRules.tenantId, session.tenantId)));
  revalidatePath("/compliance/rules");
}

// Evaluates any active "amount_threshold" rules for a module — the one
// live enforcement point wired into Expenses (see expenses/actions.ts).
// Returns a warning message (non-blocking) or throws (blocking), per each
// matching rule's configured action.
export type RuleModule = "sales" | "purchases" | "expenses" | "payroll" | "bank_reconciliation" | "general";

export async function evaluateAmountThresholdRules(tenantId: string, module: RuleModule, amount: number): Promise<string[]> {
  const rules = await db
    .select()
    .from(complianceRules)
    .where(
      and(
        eq(complianceRules.tenantId, tenantId),
        eq(complianceRules.applicableModule, module),
        eq(complianceRules.checkType, "amount_threshold"),
        eq(complianceRules.isActive, true)
      )
    );

  const warnings: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const rule of rules) {
    if (rule.effectiveDate && rule.effectiveDate > today) continue;
    if (rule.expiryDate && rule.expiryDate < today) continue;
    if (!rule.thresholdValue || amount <= Number(rule.thresholdValue)) continue;

    if (rule.action === "block") {
      throw new Error(`Blocked by rule "${rule.name}": amount exceeds ${Number(rule.thresholdValue).toFixed(2)}`);
    }
    warnings.push(`Rule "${rule.name}": amount exceeds ${Number(rule.thresholdValue).toFixed(2)}`);
  }
  return warnings;
}

// ---------- Exception Centre ----------

export async function listExceptions() {
  const session = await requireTenantSession();
  const rows = await db
    .select()
    .from(complianceExceptions)
    .where(eq(complianceExceptions.tenantId, session.tenantId))
    .orderBy(desc(complianceExceptions.detectedDate));

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));

  return rows.map((r) => ({ ...r, assignedUserName: r.assignedUserId ? nameById[r.assignedUserId] ?? "—" : null }));
}

export async function listAssignableUsers() {
  const session = await requireTenantSession();
  return listOrgUsers(session.tenantId);
}

export async function runScan() {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");

  const created = await runComplianceScan(session.tenantId);
  revalidatePath("/compliance/exceptions");
  revalidatePath("/compliance");
  return created;
}

export async function updateException(input: {
  exceptionId: string;
  status?: (typeof complianceExceptions.$inferInsert)["status"];
  assignedUserId?: string | null;
  resolution?: string;
}) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(complianceExceptions)
    .where(and(eq(complianceExceptions.id, input.exceptionId), eq(complianceExceptions.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Exception not found");

  const isResolving = input.status === "resolved" && existing.status !== "resolved";

  await db
    .update(complianceExceptions)
    .set({
      ...(input.status ? { status: input.status } : {}),
      ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution.trim() || null } : {}),
      ...(isResolving ? { resolvedBy: session.userId, resolvedAt: new Date() } : {}),
    })
    .where(eq(complianceExceptions.id, input.exceptionId));

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "exception_updated",
    entityType: "compliance_exception",
    entityId: input.exceptionId,
    before: { status: existing.status, assignedUserId: existing.assignedUserId },
    after: input,
  });

  revalidatePath("/compliance/exceptions");
  revalidatePath("/compliance");
}

// ---------- Compliance Calendar ----------

export async function listCalendarItems() {
  const session = await requireTenantSession();
  const rows = await db
    .select()
    .from(complianceCalendarItems)
    .where(eq(complianceCalendarItems.tenantId, session.tenantId))
    .orderBy(asc(complianceCalendarItems.dueDate));

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));

  return rows.map((r) => ({ ...r, responsibleUserName: r.responsibleUserId ? nameById[r.responsibleUserId] ?? "—" : "—" }));
}

export type CalendarItemInput = {
  name: string;
  applicableCompany: string;
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
  if (!input.dueDate) throw new Error("Due date is required");

  await db.insert(complianceCalendarItems).values({
    tenantId: session.tenantId,
    name: input.name.trim(),
    applicableCompany: input.applicableCompany.trim() || null,
    period: input.period.trim() || "—",
    dueDate: input.dueDate,
    responsibleUserId: input.responsibleUserId,
    amount: input.amount !== null ? input.amount.toFixed(2) : null,
    notes: input.notes.trim() || null,
  });

  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
}

export async function updateCalendarItemStatus(input: {
  itemId: string;
  status: (typeof complianceCalendarItems.$inferInsert)["status"];
  submissionDate?: string;
  paymentDate?: string;
}) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");

  await db
    .update(complianceCalendarItems)
    .set({
      status: input.status,
      ...(input.submissionDate ? { submissionDate: input.submissionDate } : {}),
      ...(input.paymentDate ? { paymentDate: input.paymentDate } : {}),
    })
    .where(and(eq(complianceCalendarItems.id, input.itemId), eq(complianceCalendarItems.tenantId, session.tenantId)));

  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
}

export async function deleteCalendarItem(itemId: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "delete")) throw new Error("Not permitted");

  await db.delete(complianceCalendarItems).where(and(eq(complianceCalendarItems.id, itemId), eq(complianceCalendarItems.tenantId, session.tenantId)));
  revalidatePath("/compliance/calendar");
}

// Seeds VAT Return / TDS Deposit items for the next several months using
// commonly-cited Nepal filing patterns — a starting point to edit or
// delete, not a guarantee of correctness (see nepal-calendar.ts).
export async function seedNepaliDefaults(monthsAhead: number) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");

  const items = generateNepaliDefaultItems(monthsAhead);
  await db.insert(complianceCalendarItems).values(
    items.map((i) => ({
      tenantId: session.tenantId,
      name: i.name,
      period: i.period,
      dueDate: i.dueDate,
      notes: "Auto-generated default — verify against current IRD deadlines.",
    }))
  );

  revalidatePath("/compliance/calendar");
  revalidatePath("/compliance");
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

// ---------- Audit trail ----------

export async function listAuditTrail(input: { from?: string; to?: string; entityType?: string }) {
  const session = await requireTenantSession();

  const conditions = [eq(auditLog.tenantId, session.tenantId)];
  if (input.from) conditions.push(gte(auditLog.timestamp, new Date(input.from)));
  if (input.to) conditions.push(lte(auditLog.timestamp, new Date(input.to + "T23:59:59")));
  if (input.entityType) conditions.push(eq(auditLog.entityType, input.entityType));

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.timestamp))
    .limit(500);

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));

  return rows.map((r) => ({ ...r, userName: r.userId ? nameById[r.userId] ?? "—" : "System" }));
}
