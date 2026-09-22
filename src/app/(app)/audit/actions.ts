"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, desc, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, complianceRules, complianceExceptions, auditLog } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { listOrgUsers } from "@/lib/org-users";
import { isOrgAdmin } from "@/lib/roles";
import { runComplianceScan } from "@/lib/compliance/exception-scan";
import { logAuditEvent } from "@/lib/audit";
import { todayIso } from "@/lib/calendar";

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
  if (!can(session, "audit", "create")) throw new Error("Not permitted");
  if (!input.label.trim()) throw new Error("Label is required");
  if (input.periodStart > input.periodEnd) throw new Error("Period start must be before period end");

  await db.insert(accountingPeriods).values({
    tenantId: session.tenantId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    label: input.label.trim(),
  });

  revalidatePath("/audit/periods");
}

// Closing a period is available to anyone with edit permission — it's the
// routine month-end action. Reopening is admin-only (see below).
export async function closePeriod(periodId: string) {
  const session = await requireTenantSession();
  if (!can(session, "audit", "edit")) throw new Error("Not permitted");

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

  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "period_closed",
    entityType: "accounting_period",
    entityId: periodId,
    before: { status: period.status },
    after: { status: "closed" },
  });

  revalidatePath("/audit/periods");
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

  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "period_reopened",
    entityType: "accounting_period",
    entityId: input.periodId,
    before: { status: "closed" },
    after: { status: "reopened", reason: input.reason.trim() },
  });

  revalidatePath("/audit/periods");
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
  if (!can(session, "audit", "create")) throw new Error("Not permitted");
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

  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "rule_created", entityType: "compliance_rule", entityId: rule.id, after: input });
  revalidatePath("/audit/rules");
}

export async function setRuleActive(input: { ruleId: string; isActive: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "audit", "edit")) throw new Error("Not permitted");

  await db
    .update(complianceRules)
    .set({ isActive: input.isActive })
    .where(and(eq(complianceRules.id, input.ruleId), eq(complianceRules.tenantId, session.tenantId)));

  revalidatePath("/audit/rules");
}

export async function deleteRule(ruleId: string) {
  const session = await requireTenantSession();
  if (!can(session, "audit", "delete")) throw new Error("Not permitted");

  await db.delete(complianceRules).where(and(eq(complianceRules.id, ruleId), eq(complianceRules.tenantId, session.tenantId)));
  revalidatePath("/audit/rules");
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
  const today = todayIso();
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
  if (!can(session, "audit", "create")) throw new Error("Not permitted");

  const created = await runComplianceScan(session.tenantId);
  revalidatePath("/audit/exceptions");
  revalidatePath("/audit");
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
  if (!can(session, "audit", "edit")) throw new Error("Not permitted");

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

  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "exception_updated",
    entityType: "compliance_exception",
    entityId: input.exceptionId,
    before: { status: existing.status, assignedUserId: existing.assignedUserId },
    after: input,
  });

  revalidatePath("/audit/exceptions");
  revalidatePath("/audit");
  revalidatePath("/compliance");
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

// ---------- Audit overview ----------

export async function getAuditOverview() {
  const session = await requireTenantSession();

  const [openExceptions, lockedPeriods, recentActivity] = await Promise.all([
    // "Open" here means still needs attention — not yet closed — matching the count Compliance shows for the same data.
    db.select().from(complianceExceptions).where(and(eq(complianceExceptions.tenantId, session.tenantId), ne(complianceExceptions.status, "closed"))),
    db.select().from(accountingPeriods).where(and(eq(accountingPeriods.tenantId, session.tenantId), eq(accountingPeriods.status, "closed"))),
    db.select().from(auditLog).where(eq(auditLog.tenantId, session.tenantId)).orderBy(desc(auditLog.timestamp)).limit(5),
  ]);

  const userList = await listOrgUsers(session.tenantId);
  const nameById = Object.fromEntries(userList.map((u) => [u.id, u.name]));
  const activeRules = await db.select({ id: complianceRules.id }).from(complianceRules).where(and(eq(complianceRules.tenantId, session.tenantId), eq(complianceRules.isActive, true)));

  return {
    openExceptionCount: openExceptions.length,
    blockingExceptionCount: openExceptions.filter((e) => e.severity === "blocking").length,
    lockedPeriodCount: lockedPeriods.length,
    activeRuleCount: activeRules.length,
    recentActivity: recentActivity.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, at: r.timestamp.toISOString(), userName: r.userId ? nameById[r.userId] ?? "—" : "System" })),
  };
}
