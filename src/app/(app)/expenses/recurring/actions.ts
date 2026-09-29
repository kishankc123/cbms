"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { todayIso } from "@/lib/calendar";
import {
  createRecurringExpense as createRecurringExpenseRow,
  updateRecurringExpense as updateRecurringExpenseRow,
  pauseRecurringExpense as pauseRecurringExpenseRow,
  resumeRecurringExpense as resumeRecurringExpenseRow,
  stopRecurringExpense as stopRecurringExpenseRow,
  type RecurringExpenseInput,
} from "@/lib/recurring-expenses";
import { runRecurringExpenseEngine } from "@/lib/recurring-expenses/generate";

export async function createRecurringExpense(input: RecurringExpenseInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");

  const row = await createRecurringExpenseRow(session.tenantId, session.userId, input);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "recurring_expense_created", entityType: "recurring_expense", entityId: row.id, after: input });
  revalidatePath("/expenses/recurring");
  return row;
}

export async function updateRecurringExpense(id: string, input: RecurringExpenseInput) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const row = await updateRecurringExpenseRow(session.tenantId, session.userId, id, input);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "recurring_expense_updated", entityType: "recurring_expense", entityId: id, after: input });
  revalidatePath("/expenses/recurring");
  return row;
}

export async function pauseRecurringExpense(id: string) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const row = await pauseRecurringExpenseRow(session.tenantId, id);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "recurring_expense_paused", entityType: "recurring_expense", entityId: id });
  revalidatePath("/expenses/recurring");
  return row;
}

export async function resumeRecurringExpense(id: string, resumeFrom: string) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const row = await resumeRecurringExpenseRow(session.tenantId, id, resumeFrom);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "recurring_expense_resumed", entityType: "recurring_expense", entityId: id, after: { resumeFrom } });
  revalidatePath("/expenses/recurring");
  return row;
}

export async function stopRecurringExpense(id: string, effectiveDate: string) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "edit")) throw new Error("Not permitted");

  const row = await stopRecurringExpenseRow(session.tenantId, id, effectiveDate);
  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "recurring_expense_stopped", entityType: "recurring_expense", entityId: id, after: { effectiveDate } });
  revalidatePath("/expenses/recurring");
  return row;
}

/**
 * Expands schedules and posts any occurrence whose recognition date has arrived.
 * No cron exists in this app (see the recurring-expenses feature's project memory) —
 * this is meant to be triggered whenever the Recurring Expenses page is visited
 * (see RecurringEngineRunner), the same on-demand-and-idempotent shape the
 * compliance module already uses for its own obligations.
 */
export async function runRecurringExpensesEngine() {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");

  const result = await runRecurringExpenseEngine(session.tenantId, session.userId, session.calendar, todayIso());
  if (result.scheduled > 0 || result.recognized > 0) {
    revalidatePath("/expenses/recurring");
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    revalidatePath("/journal");
  }
  return result;
}
