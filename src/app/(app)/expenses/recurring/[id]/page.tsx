import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { getRecurringExpenseHistory } from "@/lib/recurring-expenses";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { eq } from "drizzle-orm";
import { D } from "@/components/calendar/date-text";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { BackButton } from "@/components/ui/back-button";

const currency = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const FREQUENCY_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-Yearly", yearly: "Yearly", custom: "Custom" };
const STATUS_INFO: Record<string, { tone: StatusTone; label: string }> = {
  expected: { tone: "pending", label: "Expected" },
  unpaid: { tone: "action", label: "Unpaid" },
  partially_paid: { tone: "action", label: "Partially Paid" },
  paid: { tone: "success", label: "Paid" },
  void: { tone: "critical", label: "Void" },
};

export default async function RecurringExpenseHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "view")) throw new Error("Not permitted");
  const { id } = await params;

  const history = await getRecurringExpenseHistory(session.tenantId, id);
  if (!history) throw new Error("Recurring expense not found");
  const { recurring, periods } = history;

  const [categoryAccounts, vendor] = await Promise.all([
    getExpenseCategoryAccounts(session.tenantId),
    recurring.vendorId ? db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, recurring.vendorId)).limit(1).then((r) => r[0]?.name ?? null) : Promise.resolve(null),
  ]);
  const accountLabel = categoryAccounts.find((a) => a.id === recurring.expenseAccountId);
  const payee = vendor ?? recurring.payeeName ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <BackButton href="/expenses/recurring" label="Back to Recurring Expenses" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{recurring.expenseName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Recurring expense history</p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Account</p>
          <p className="font-medium text-[var(--text-primary)]">{accountLabel ? `${accountLabel.code} — ${accountLabel.name}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Payable To</p>
          <p className="font-medium text-[var(--text-primary)]">{payee}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Amount</p>
          <p className="font-medium text-[var(--text-primary)]">{currency(Number(recurring.amount))}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Frequency</p>
          <p className="font-medium text-[var(--text-primary)]">{FREQUENCY_LABEL[recurring.frequency] ?? recurring.frequency}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Start Date</p>
          <p className="font-medium text-[var(--text-primary)]">
            <D value={recurring.startDate} style="short" />
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">End Date</p>
          <p className="font-medium text-[var(--text-primary)]">{recurring.endDate ? <D value={recurring.endDate} style="short" /> : "Continues until stopped"}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Status</p>
          <StatusPill tone={recurring.status === "active" ? "success" : recurring.status === "paused" ? "pending" : "critical"}>
            {recurring.status[0].toUpperCase() + recurring.status.slice(1)}
          </StatusPill>
        </div>
        {recurring.notes && (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-xs text-[var(--text-secondary)]">Notes</p>
            <p className="font-medium text-[var(--text-primary)]">{recurring.notes}</p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--card-border)] text-left text-xs text-[var(--text-secondary)]">
              <th className="px-4 py-2.5 font-medium">Period</th>
              <th className="px-4 py-2.5 font-medium">Expense Date</th>
              <th className="px-4 py-2.5 font-medium">Due Date</th>
              <th className="px-4 py-2.5 font-medium text-right">Expected</th>
              <th className="px-4 py-2.5 font-medium text-right">Paid</th>
              <th className="px-4 py-2.5 font-medium text-right">Remaining</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Reference</th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No periods scheduled yet.
                </td>
              </tr>
            )}
            {periods.map((p) => {
              const info = STATUS_INFO[p.status] ?? STATUS_INFO.expected;
              return (
                <tr key={p.id} className="border-b border-[var(--card-border)] last:border-0">
                  <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{p.periodLabel}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    <D value={p.expenseDate} style="short" />
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.dueDate ? <D value={p.dueDate} style="short" /> : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">{currency(p.expectedAmount)}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{p.amountPaid !== null ? currency(p.amountPaid) : "—"}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{p.remaining !== null ? currency(p.remaining) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={info.tone}>{info.label}</StatusPill>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.expenseNumber ? (
                      <Link href={`/reports/journal-report?q=${p.expenseNumber}&from=${p.expenseDate}&to=${p.expenseDate}`} className="text-xs font-medium text-[var(--color-primary)] hover:underline">
                        {p.expenseNumber}
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--text-secondary)]">Not yet posted</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
