import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, bankStatementLines, journalEntries, journalLines, notificationStates, payrollRuns } from "@/db/schema";
import { addDays } from "@/lib/calendar";
import { DUE_SOON_DAYS } from "@/lib/compliance/engine/status";
import { complianceSummary, needsAttention, type NeedsAttentionItem } from "@/lib/dashboard/aggregates";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import { plural, type Notif, type NotifGroup, type NotifState, type StateAction } from "./notification-rules";

export * from "./notification-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | null | undefined) => Number(v ?? 0);
const daysSince = (from: string | null, today: string) => (from ? Math.max(0, Math.round((new Date(today + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000)) : null);

// Where each of the dashboard's Needs attention items belongs in the bell, and where Open takes the person.
const ATTENTION: Record<NeedsAttentionItem["id"], { group: NotifGroup; href: string }> = {
  trial_balance: { group: "alert", href: "/reports/trial-balance" },
  draft_invoices: { group: "verify", href: "/sales" },
  draft_bills: { group: "verify", href: "/purchases" },
  details_pending: { group: "verify", href: "/purchases/stockable" },
  negative_stock: { group: "alert", href: "/inventory/items" },
  overdue_receivables: { group: "alert", href: "/reports/receivable-ageing" },
  cheques_due: { group: "due", href: "/payments/cheques" },
  received_cheques_ready: { group: "verify", href: "/payments/cheques-received" },
};

/**
 * Everything that needs a person's attention, worked out live from the books. \`allowed\` says which kinds the person may see (by module permission), and
 * nothing is queried for a kind they may not: the bell never reveals a figure the screen behind it would refuse. One entry per kind of notification.
 */
export async function loadNotifications(tenantId: string, today: string, allowed: (key: string) => boolean): Promise<Notif[]> {
  const out: Notif[] = [];
  const tasks: Promise<void>[] = [];

  // The same checks the Overview's Needs attention list makes.
  if (Object.keys(ATTENTION).some(allowed)) {
    tasks.push(
      needsAttention(tenantId, today).then((items) => {
        for (const it of items) {
          if (!allowed(it.id)) continue;
          const meta = ATTENTION[it.id];
          out.push({ key: it.id, group: meta.group, severity: it.severity === "critical" ? "critical" : "action", title: it.label, detail: it.detail, href: meta.href, count: it.count ?? 1, amount: it.amount ?? null, sinceDays: null });
        }
      })
    );
  }

  // Bank statement lines that no one has matched yet (or that have a suggestion waiting for a yes).
  if (allowed("bank_unmatched")) {
    tasks.push(
      db
        .select({ count: sql<string>`count(*)`, oldest: sql<string>`min(${bankStatementLines.transactionDate})`, amount: sql<string>`coalesce(sum(abs(${bankStatementLines.amount})), 0)` })
        .from(bankStatementLines)
        .where(and(eq(bankStatementLines.tenantId, tenantId), inArray(bankStatementLines.matchStatus, ["unmatched", "suggested"])))
        .then(([r]) => {
          const n = Number(r?.count ?? 0);
          if (n > 0) out.push({ key: "bank_unmatched", group: "verify", severity: "action", title: `${plural(n, "bank statement line", "bank statement lines")} not matched`, detail: `The oldest is from ${r.oldest}.`, href: "/bank-reconciliation", count: n, amount: round2(num(r.amount)), sinceDays: daysSince(r.oldest, today) });
        })
    );
  }

  // Payroll runs that were made but not finalized: nothing is posted for them yet.
  if (allowed("payroll_runs")) {
    tasks.push(
      db
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.status, ["review", "approved"])))
        .orderBy(desc(payrollRuns.periodStart))
        .then((runs) => {
          if (runs.length === 0) return;
          const oldest = runs.reduce((m, r) => (r.periodEnd < m ? r.periodEnd : m), runs[0].periodEnd);
          const one = runs.length === 1 ? runs[0] : null;
          out.push({
            key: "payroll_runs",
            group: "verify",
            severity: "action",
            title: one ? `Payroll for ${payrollPeriodLabel(one)} is ${one.status === "review" ? "in review" : "approved, not finalized"}` : `${runs.length} payroll runs are not finalized`,
            detail: "Finalize it to post the salary and the contributions.",
            href: one ? `/payroll/salary-sheet/${one.id}` : "/payroll/salary-sheet",
            count: runs.length,
            amount: null,
            sinceDays: daysSince(oldest, today),
          });
        })
    );
  }

  // What payroll owes the retirement funds (SSF, PF, CIT, gratuity), from the accounts payroll credits.
  if (allowed("contributions_owed")) {
    tasks.push(
      (async () => {
        const accounts = await db.select({ id: accountRoles.accountId }).from(accountRoles).where(and(eq(accountRoles.tenantId, tenantId), like(accountRoles.roleKey, "payroll_retirement:%")));
        if (accounts.length === 0) return;
        const [row] = await db
          .select({ owed: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accounts.map((a) => a.id))));
        const owed = round2(num(row?.owed));
        if (owed > 0.004) out.push({ key: "contributions_owed", group: "due", severity: "action", title: "Retirement contributions are owed", detail: "Pay SSF, PF and CIT from Contributions.", href: "/payroll/contributions", count: 1, amount: owed, sinceDays: null });
      })()
    );
  }

  // Compliance items that are past their date, and those coming up.
  if (allowed("compliance_overdue") || allowed("compliance_due")) {
    tasks.push(
      complianceSummary(tenantId, today).then((s) => {
        if (s.overdue > 0 && allowed("compliance_overdue")) out.push({ key: "compliance_overdue", group: "alert", severity: "critical", title: `${plural(s.overdue, "compliance item is", "compliance items are")} overdue`, detail: "Past the due date and not filed or paid.", href: "/compliance", count: s.overdue, amount: null, sinceDays: null });
        if (s.dueSoon > 0 && allowed("compliance_due")) out.push({ key: "compliance_due", group: "due", severity: "action", title: `${plural(s.dueSoon, "compliance item is", "compliance items are")} due in the next ${DUE_SOON_DAYS} days`, detail: "See the compliance calendar for which ones.", href: "/compliance", count: s.dueSoon, amount: null, sinceDays: null });
      })
    );
  }

  await Promise.all(tasks);
  return out;
}

/** This person's choices, for the notifications of one organization. */
export async function loadStates(tenantId: string, userId: string): Promise<NotifState[]> {
  const rows = await db.select().from(notificationStates).where(and(eq(notificationStates.tenantId, tenantId), eq(notificationStates.userId, userId)));
  return rows.map((r) => ({ key: r.key, state: r.state === "snoozed" ? "snoozed" : "seen", snoozedUntil: r.snoozedUntil, countAt: r.countAt }));
}

/** Records (or clears) one person's choice about one kind of notification, remembering how many things were behind it. */
export async function saveState(tenantId: string, userId: string, key: string, action: StateAction, count: number, today: string) {
  if (action === "unseen") {
    await db.delete(notificationStates).where(and(eq(notificationStates.tenantId, tenantId), eq(notificationStates.userId, userId), eq(notificationStates.key, key)));
    return;
  }
  const state = action === "seen" ? "seen" : "snoozed";
  const snoozedUntil = action === "snooze1" ? addDays(today, 1) : action === "snooze7" ? addDays(today, 7) : null;
  const countAt = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
  await db
    .insert(notificationStates)
    .values({ tenantId, userId, key, state, snoozedUntil, countAt })
    .onConflictDoUpdate({ target: [notificationStates.tenantId, notificationStates.userId, notificationStates.key], set: { state, snoozedUntil, countAt, updatedAt: new Date() } });
}
