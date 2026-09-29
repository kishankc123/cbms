"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { fiscalYears } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { listFiscalYears, createFiscalYear, deleteFiscalYear as deleteFiscalYearRow, earliestSelectableFiscalYearStartYear } from "@/lib/fiscal";
import { getYearEndReadiness, getOpeningBalanceReconciliation } from "@/lib/fiscal-closing";
import { logAuditEvent } from "@/lib/audit";
import { bsFiscalYearOf, todayIso } from "@/lib/calendar";

export async function getYearEndReviewData(fiscalYearId: string) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "view")) throw new Error("Not permitted");
  return getYearEndReadiness(session.tenantId, fiscalYearId);
}

export async function getReconciliationData(fiscalYearId: string) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "view")) throw new Error("Not permitted");
  return getOpeningBalanceReconciliation(session.tenantId, fiscalYearId);
}

export async function getFiscalYearsPageData() {
  const session = await requireTenantSession();
  if (!can(session, "settings", "view")) throw new Error("Not permitted");
  const [years, floorStartYear] = await Promise.all([listFiscalYears(session.tenantId), earliestSelectableFiscalYearStartYear(session.tenantId)]);
  // The BS year containing today — the natural default selection in the "add fiscal year" picker.
  const currentStartYear = bsFiscalYearOf(todayIso())?.startYear ?? null;
  return { years, floorStartYear, currentStartYear };
}

export async function addFiscalYear(input: { startYear: number }) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");
  const created = await createFiscalYear(session.tenantId, input);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "fiscal_year_created", entityType: "fiscal_year", entityId: created.id, after: { code: created.code, startDate: created.startDate, endDate: created.endDate } });
  revalidatePath("/settings/fiscal-years");
}

// Closing is the routine year-end action, available to anyone with settings-edit rights — same split
// as accounting-period locking (audit/actions.ts): closing is routine, reopening is admin-only.
export async function closeFiscalYear(fiscalYearId: string) {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) throw new Error("Not permitted");

  const [fy] = await db.select().from(fiscalYears).where(and(eq(fiscalYears.id, fiscalYearId), eq(fiscalYears.tenantId, session.tenantId))).limit(1);
  if (!fy) throw new Error("Fiscal year not found");
  if (fy.status === "closed") throw new Error("This fiscal year is already closed");

  // The wizard's Step 1 checklist is re-verified here, not just in the UI — a stale page (or a direct
  // call) can't skip past unresolved drafts, an unbalanced trial balance, or negative stock.
  const readiness = await getYearEndReadiness(session.tenantId, fiscalYearId);
  if (!readiness.canClose) {
    throw new Error(`Cannot close — ${readiness.issues.map((i) => `${i.label} (${i.count})`).join("; ")}`);
  }

  await db.update(fiscalYears).set({ status: "closed", closedBy: session.userId, closedAt: new Date() }).where(eq(fiscalYears.id, fiscalYearId));
  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "fiscal_year_closed",
    entityType: "fiscal_year",
    entityId: fiscalYearId,
    before: { status: fy.status },
    after: { status: "closed", netProfit: readiness.profitAndLoss.netProfit, totalAssets: readiness.balanceSheet.totalAssets },
  });
  revalidatePath("/settings/fiscal-years");

  return { reconciliation: await getOpeningBalanceReconciliation(session.tenantId, fiscalYearId) };
}

// Admin-only, reason required — matching reopenPeriod (audit/actions.ts) and reopenReconciliation
// (bank-reconciliation/actions.ts): no separate approval step, but always an audited reason.
export async function reopenFiscalYear(input: { fiscalYearId: string; reason: string }) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an admin can reopen a closed fiscal year");
  if (!input.reason.trim()) throw new Error("A reason is required to reopen a fiscal year");

  const [fy] = await db.select().from(fiscalYears).where(and(eq(fiscalYears.id, input.fiscalYearId), eq(fiscalYears.tenantId, session.tenantId))).limit(1);
  if (!fy) throw new Error("Fiscal year not found");
  if (fy.status !== "closed") throw new Error("Only a closed fiscal year can be reopened");

  await db.update(fiscalYears).set({ status: "reopened", reopenedBy: session.userId, reopenedAt: new Date(), reopenReason: input.reason.trim() }).where(eq(fiscalYears.id, input.fiscalYearId));
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "fiscal_year_reopened", entityType: "fiscal_year", entityId: input.fiscalYearId, before: { status: "closed" }, after: { status: "reopened", reason: input.reason.trim() } });
  revalidatePath("/settings/fiscal-years");
}

// Admin-only, same footing as reopening — deleting a fiscal year (even an empty one) changes the
// organization's accounting configuration, not routine data entry. The library function itself
// refuses if anything has actually been posted into it, so this can never silently orphan real
// financial data; it exists to correct a wrong fiscal year (e.g. one auto-created under an older
// rule) that nothing has touched yet.
export async function deleteFiscalYear(fiscalYearId: string) {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an admin can delete a fiscal year");

  const [fy] = await db.select().from(fiscalYears).where(and(eq(fiscalYears.id, fiscalYearId), eq(fiscalYears.tenantId, session.tenantId))).limit(1);
  if (!fy) throw new Error("Fiscal year not found");

  await deleteFiscalYearRow(session.tenantId, fiscalYearId);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "fiscal_year_deleted", entityType: "fiscal_year", entityId: fiscalYearId, before: { code: fy.code, startDate: fy.startDate, endDate: fy.endDate, status: fy.status } });
  revalidatePath("/settings/fiscal-years");
}
