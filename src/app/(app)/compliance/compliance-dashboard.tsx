"use client";

import Link from "next/link";
import type { getComplianceDashboard } from "./actions";

type Data = Awaited<ReturnType<typeof getComplianceDashboard>>;

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" | "good" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-green-600" : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

export function ComplianceDashboard({ data }: { data: Data }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Link href="/compliance/calendar" className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">
          Compliance Calendar
        </Link>
        <Link href="/compliance/reports" className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">
          Generate Reports
        </Link>
        <Link href="/compliance/rules" className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
          Rules & Policies
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <SummaryCard label="Due" value={data.summary.due} tone="warn" />
        <SummaryCard label="Upcoming" value={data.summary.upcoming} />
        <SummaryCard label="Completed" value={data.summary.completed} tone="good" />
        <SummaryCard label="Overdue" value={data.summary.overdue} tone="bad" />
        <SummaryCard label="Exceptions" value={data.summary.exceptions} tone={data.summary.exceptions > 0 ? "bad" : "good"} />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Compliance item</th>
            <th className="px-4 py-2 font-medium">Period</th>
            <th className="px-4 py-2 font-medium">Due date</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Responsible user</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{i.name}</td>
              <td className="px-4 py-2">{i.period}</td>
              <td className="px-4 py-2">{i.dueDate}</td>
              <td className="px-4 py-2 capitalize">{i.status.replace("_", " ")}</td>
              <td className="px-4 py-2">{i.amount !== null ? i.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
              <td className="px-4 py-2">{i.responsibleUserName}</td>
              <td className="px-4 py-2 text-right">
                <Link href="/compliance/calendar" className="text-xs text-[var(--color-primary)] hover:underline">
                  Open
                </Link>
              </td>
            </tr>
          ))}
          {data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No compliance items yet — add some from the Compliance Calendar
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
