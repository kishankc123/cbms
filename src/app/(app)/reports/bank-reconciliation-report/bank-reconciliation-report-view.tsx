"use client";

import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import type { ReconciliationReportRow } from "@/lib/banking/reconciliation-report";

const fmt = (n: number) => n.toFixed(2);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const STATUS_LABEL: Record<ReconciliationReportRow["status"], string> = {
  reconciled: "Reconciled",
  reopened: "Reopened",
  in_progress: "In progress",
};

export function BankReconciliationReportView({ rows }: { rows: ReconciliationReportRow[] }) {
  function exportCsv() {
    const header = ["Bank Account", "Period Start", "Period End", "Statement Balance", "Ledger Balance", "Difference", "Status", "Reconciled By", "Reconciled At", "Reopen Reason"];
    const dataRows = rows.map((r) => [
      r.bankAccountName,
      r.periodStart,
      r.periodEnd,
      fmt(r.statementBalance),
      fmt(r.ledgerBalance),
      fmt(r.difference),
      STATUS_LABEL[r.status],
      r.reconciledByName ?? "",
      r.reconciledAt ?? "",
      r.reopenReason ?? "",
    ]);
    const csv = [header, ...dataRows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bank-reconciliation-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button type="button" onClick={exportCsv} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5">
          Export CSV
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Bank Account</th>
            <th className="px-4 py-2 font-medium">Period</th>
            <th className="px-4 py-2 font-medium text-right">Statement Balance</th>
            <th className="px-4 py-2 font-medium text-right">Ledger Balance</th>
            <th className="px-4 py-2 font-medium text-right">Difference</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Reconciled By</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{r.bankAccountName}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                <D value={r.periodStart} /> – <D value={r.periodEnd} />
              </td>
              <td className="px-4 py-2 text-right">{fmt(r.statementBalance)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.ledgerBalance)}</td>
              <td className="px-4 py-2 text-right">{fmt(r.difference)}</td>
              <td className="px-4 py-2">
                <StatusPill tone={r.status === "reconciled" ? "success" : r.status === "reopened" ? "critical" : "pending"}>{STATUS_LABEL[r.status]}</StatusPill>
                {r.status === "reopened" && r.reopenReason && <div className="mt-1 text-xs text-gray-500">{r.reopenReason}</div>}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">
                {r.reconciledByName ?? "—"}
                {r.reconciledAt && (
                  <div className="text-xs text-gray-500">
                    <D value={r.reconciledAt} />
                  </div>
                )}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">
                <Link href="/bank-reconciliation" className="text-xs text-[var(--color-primary)] hover:underline">
                  Open in Bank Reconciliation
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                No reconciliations recorded yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
