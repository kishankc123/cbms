"use client";

import Link from "next/link";
import type { getComplianceDashboard } from "./actions";
import { ObligationStatusPill } from "@/components/compliance/status-pill";
import { D } from "@/components/calendar/date-text";

type Data = Awaited<ReturnType<typeof getComplianceDashboard>>;

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" | "good" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "bad" && value > 0 ? "text-red-600" : tone === "warn" && value > 0 ? "text-amber-600" : tone === "good" ? "text-green-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

// Focused on what needs attention: who the company is, four counts, where the
// open items are, and what is coming up. Detail lives on each section's page.
export function ComplianceDashboard({ data }: { data: Data }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-lg font-semibold text-gray-900">{data.company.name}</p>
        <p className="mt-1 text-sm text-gray-500">
          {data.company.country}
          <span className="mx-2 text-gray-300">|</span>
          {data.company.entityType ?? (
            <Link href="/compliance/company" className="text-amber-700 underline">
              Set your company type
            </Link>
          )}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Due soon (next 7 days)" value={data.summary.due} tone="warn" />
        <SummaryCard label="Overdue" value={data.summary.overdue} tone="bad" />
        <SummaryCard label="Completed" value={data.summary.completed} tone="good" />
        <SummaryCard label="Upcoming" value={data.summary.upcoming} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {data.categories.map((c) => (
          <Link key={c.key} href={c.href} className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50/60">
            <p className="text-sm font-medium text-gray-900">{c.name}</p>
            <div className="mt-2 flex gap-6 text-sm text-gray-500">
              <span>
                Pending: <span className="font-semibold text-gray-900">{c.pending}</span>
              </span>
              <span>
                Overdue: <span className={`font-semibold ${c.overdue > 0 ? "text-red-600" : "text-gray-900"}`}>{c.overdue}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Upcoming compliance</h2>
          <Link href="/compliance/calendar" className="text-xs text-[var(--color-primary)] hover:underline">
            Open calendar
          </Link>
        </div>
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Requirement</th>
              <th className="px-4 py-2 font-medium">Period</th>
              <th className="px-4 py-2 font-medium">Due date</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {data.upcoming.map((i) => (
              <tr key={i.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{i.name}</td>
                <td className="px-4 py-2">{i.period}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <D value={i.dueDate} />
                </td>
                <td className="px-4 py-2">
                  <ObligationStatusPill status={i.status} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={i.href} className="text-xs text-[var(--color-primary)] hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {data.upcoming.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Nothing needs attention. Requirements appear here once your company type and tax registrations are set.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {data.summary.exceptions > 0 && (
        <p className="text-xs text-gray-500">
          {data.summary.exceptions} open exception{data.summary.exceptions === 1 ? "" : "s"} —{" "}
          <Link href="/audit/exceptions" className="text-[var(--color-primary)] hover:underline">
            open the Exception Centre
          </Link>
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">This month</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">Sales / Purchases</p>
            <p className="mt-1 text-sm text-gray-900">
              {fmt(data.thisMonth.salesTotal)} / {fmt(data.thisMonth.purchasesTotal)}
            </p>
          </div>
          <Link href="/compliance/tax" className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50/60">
            <p className="text-xs text-gray-500">VAT payable this month</p>
            <p className="mt-1 text-sm text-gray-900">{fmt(data.thisMonth.vatPayable)}</p>
            <p className="text-xs text-gray-400">Outstanding: {fmt(data.thisMonth.vatOutstanding)}</p>
          </Link>
          <Link href="/compliance/tax" className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50/60">
            <p className="text-xs text-gray-500">TDS withheld this month</p>
            <p className="mt-1 text-sm text-gray-900">{fmt(data.thisMonth.tdsWithheld)}</p>
            <p className="text-xs text-gray-400">Outstanding: {fmt(data.thisMonth.tdsOutstanding)}</p>
          </Link>
        </div>
      </section>
    </div>
  );
}
