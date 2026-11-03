"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip } from "@/components/ui/stat-strip";
import { Amount, DataTable, Td, Th, Tr } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
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

export type RecurringSummary = { activeCount: number; expectedThisMonth: number; expectedNext30Days: number; outstandingLiabilities: number; overdueCount: number; overdueAmount: number };

export function RecurringExpensesTable({
  summary,
  expenses,
  vendors,
  categoryAccounts,
  cashBankAccounts,
}: {
  summary: RecurringSummary;
  expenses: RecurringExpenseRow[];
  vendors: Vendor[];
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
}) {
  const calendar = useCalendar();
  const [editing, setEditing] = useState<InitialRecurringExpense | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recurring expenses"
        description="Rent, subscriptions, and other expenses that repeat on a schedule."
        back={{ href: "/expenses", label: "Back to One-off Expenses" }}
        primary={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New recurring expense
          </Button>
        }
      />

      <StatStrip
        items={[
          { label: "Active recurring expenses", value: summary.activeCount },
          { label: "Expected this month", value: currency(summary.expectedThisMonth) },
          { label: "Expected next 30 days", value: currency(summary.expectedNext30Days) },
          { label: "Outstanding liabilities", value: currency(summary.outstandingLiabilities) },
          {
            label: "Overdue payments",
            tone: summary.overdueCount > 0 ? "danger" : "default",
            value: (
              <>
                {summary.overdueCount} {summary.overdueCount === 1 ? "item" : "items"}
                {summary.overdueCount > 0 && <span className="ml-2 text-xs font-normal text-ink-2">{currency(summary.overdueAmount)}</span>}
              </>
            ),
          },
        ]}
      />

      <DataTable>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>Expense</Th>
            <Th>Account</Th>
            <Th>Payable to</Th>
            <Th align="right">Amount</Th>
            <Th>Frequency</Th>
            <Th>Next expense</Th>
            <Th>Due date</Th>
            <Th>Priority</Th>
            <Th>Status</Th>
            <Th align="right">Actions</Th>
          </Tr>
        </thead>
        <tbody>
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
              <Tr key={row.id}>
                <Td className="font-medium">{row.expenseName}</Td>
                <Td className="text-ink-2">{row.expenseAccountLabel}</Td>
                <Td className="text-ink-2">{row.payee}</Td>
                <Td numeric className="font-medium">
                  <Amount value={row.amount} />
                </Td>
                <Td className="text-ink-2">{FREQUENCY_LABEL[row.frequency]}</Td>
                <Td className="whitespace-nowrap text-ink-2">{preview ? <D value={preview.expenseDate} style="short" /> : "—"}</Td>
                <Td className="whitespace-nowrap text-ink-2">{preview ? <D value={preview.dueDate} style="short" /> : "—"}</Td>
                <Td>
                  <StatusPill tone={PRIORITY_TONE[row.priority]}>{row.priority[0].toUpperCase() + row.priority.slice(1)}</StatusPill>
                </Td>
                <Td>
                  <StatusPill tone={statusInfo.tone}>{statusInfo.label}</StatusPill>
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-3">
                    <Link href={`/expenses/recurring/${row.id}`} className="text-xs font-medium text-accent-text hover:underline">
                      History
                    </Link>
                    <button type="button" onClick={() => setEditing(row.raw)} className="text-xs font-medium text-accent-text hover:underline">
                      Edit
                    </button>
                    <LifecycleActions id={row.id} status={row.status} />
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </DataTable>
      {expenses.length === 0 && (
        <EmptyState
          icon={Repeat}
          title="No recurring expenses yet"
          description="Add rent, subscriptions, or other regular expenses and they will be recorded on schedule."
          action={
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              New recurring expense
            </Button>
          }
        />
      )}

      {creating && <RecurringExpenseFormModal vendors={vendors} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} onClose={() => setCreating(false)} />}
      {editing && <RecurringExpenseFormModal vendors={vendors} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
