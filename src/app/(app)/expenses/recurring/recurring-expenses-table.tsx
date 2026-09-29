"use client";

import { useState } from "react";
import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { previewNextOccurrence, type RecurringFrequency, type RecurringPriority, type RecurringStatus } from "@/lib/recurring-expenses/schedule";
import { RecurringExpenseFormModal, type InitialRecurringExpense } from "./recurring-expense-form-modal";
import { LifecycleActions } from "./lifecycle-actions";

type Vendor = { id: string; name: string };
type CategoryAccount = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

export type RecurringExpenseRow = {
  id: string;
  expenseName: string;
  expenseAccountLabel: string;
  payee: string;
  amount: number;
  frequency: RecurringFrequency;
  priority: RecurringPriority;
  status: RecurringStatus;
  raw: InitialRecurringExpense;
};

const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  yearly: "Yearly",
  custom: "Custom",
};

const PRIORITY_TONE: Record<RecurringPriority, StatusTone> = {
  critical: "critical",
  high: "action",
  normal: "pending",
  low: "success",
};

const STATUS_TONE: Record<RecurringStatus, { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  paused: { tone: "pending", label: "Paused" },
  stopped: { tone: "critical", label: "Stopped" },
};

const currency = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export function RecurringExpensesTable({
  expenses,
  vendors,
  categoryAccounts,
  cashBankAccounts,
}: {
  expenses: RecurringExpenseRow[];
  vendors: Vendor[];
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
}) {
  const calendar = useCalendar();
  const [editing, setEditing] = useState<InitialRecurringExpense | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] px-4 py-2 text-sm font-medium text-white"
        >
          + New Recurring Expense
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)] text-left text-xs text-[var(--text-secondary)]">
              <th className="px-4 py-2.5 font-medium">Expense</th>
              <th className="px-4 py-2.5 font-medium">Account</th>
              <th className="px-4 py-2.5 font-medium">Payable To</th>
              <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              <th className="px-4 py-2.5 font-medium">Frequency</th>
              <th className="px-4 py-2.5 font-medium">Next Expense</th>
              <th className="px-4 py-2.5 font-medium">Due Date</th>
              <th className="px-4 py-2.5 font-medium">Priority</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No recurring expenses yet — add rent, subscriptions, or other regular expenses with{" "}
                  <button type="button" onClick={() => setCreating(true)} className="text-[var(--color-primary)] hover:underline">
                    + New Recurring Expense
                  </button>
                  .
                </td>
              </tr>
            )}
            {expenses.map((row) => {
              let preview: ReturnType<typeof previewNextOccurrence> | null = null;
              try {
                preview = previewNextOccurrence({
                  calendar,
                  startDate: row.raw.startDate,
                  recognitionRule: row.raw.recognitionRule,
                  recognitionDay: row.raw.recognitionDay,
                  dueRule: row.raw.dueRule,
                  dueRuleValue: row.raw.dueRuleValue,
                });
              } catch {
                preview = null;
              }
              const statusInfo = STATUS_TONE[row.status];
              return (
                <tr key={row.id} className="border-b border-[var(--card-border)] last:border-0">
                  <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{row.expenseName}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{row.expenseAccountLabel}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{row.payee}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">{currency(row.amount)}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{FREQUENCY_LABEL[row.frequency]}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{preview ? <D value={preview.expenseDate} style="short" /> : "—"}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{preview ? <D value={preview.dueDate} style="short" /> : "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={PRIORITY_TONE[row.priority]}>{row.priority[0].toUpperCase() + row.priority.slice(1)}</StatusPill>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={statusInfo.tone}>{statusInfo.label}</StatusPill>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-3">
                      <Link href={`/expenses/recurring/${row.id}`} className="text-xs font-medium text-[var(--color-primary)] hover:underline">
                        History
                      </Link>
                      <button type="button" onClick={() => setEditing(row.raw)} className="text-xs font-medium text-[var(--color-primary)] hover:underline">
                        Edit
                      </button>
                      <LifecycleActions id={row.id} status={row.status} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && (
        <RecurringExpenseFormModal vendors={vendors} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <RecurringExpenseFormModal vendors={vendors} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} initial={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
