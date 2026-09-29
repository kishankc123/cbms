"use client";

import { useState } from "react";
import Link from "next/link";

export type ExpenseCategory = { accountId: string; code: string; name: string; amount: number };

const currency = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/** Expense Breakdown widget — pick a category from the dropdown to "track" it: the summary line
 * and that row's highlight update, both driven by the same client-side selection state. */
export function ExpenseTracker({ categories, otherAmount, total, reportHref }: { categories: ExpenseCategory[]; otherAmount: number; total: number; reportHref?: string }) {
  const rows = otherAmount > 0 ? [...categories, { accountId: "__other__", code: "", name: "Other expenses", amount: otherAmount }] : categories;
  const [trackedId, setTrackedId] = useState(rows[0]?.accountId ?? "");
  const tracked = rows.find((r) => r.accountId === trackedId) ?? rows[0];
  const max = Math.max(...rows.map((r) => r.amount), 1);

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">No expenses posted in this period.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Expense Breakdown</h2>
        <div className="flex items-center gap-2">
          <select
            value={trackedId}
            onChange={(e) => setTrackedId(e.target.value)}
            className="rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)]"
          >
            {rows.map((r) => (
              <option key={r.accountId} value={r.accountId}>
                {r.name}
              </option>
            ))}
          </select>
          {reportHref && (
            <Link href={reportHref} className="text-xs font-medium text-[var(--color-primary)] hover:underline whitespace-nowrap">
              View P&amp;L →
            </Link>
          )}
        </div>
      </div>

      {tracked && (
        <div className="rounded-md bg-[var(--surface-muted-bg)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          Tracking <strong className="text-[var(--text-primary)]">{tracked.name}</strong> — {currency(tracked.amount)} of {currency(total)} total expenses
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const isTracked = r.accountId === trackedId;
          return (
            <div key={r.accountId} className={isTracked ? "rounded-md bg-[var(--surface-muted-bg)] p-2 -mx-2" : ""}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-medium text-[var(--text-primary)]">{r.name}</span>
                <span className="font-semibold text-[var(--text-primary)]">{currency(r.amount)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted-bg)]">
                <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.max((r.amount / max) * 100, 2)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
