import Link from "next/link";

import { D } from "@/components/calendar/date-text";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
type Run = { id: string; calendarSystem: string; month: number; year: number; status: string; periodStart: string; periodEnd: string };

export function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
      <thead className="bg-gray-50 text-left text-gray-500">
        <tr>
          <th className="px-4 py-2 font-medium">Period</th>
          <th className="px-4 py-2 font-medium">Date Range</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-t border-gray-100">
            <td className="px-4 py-2">
              {payrollPeriodLabel(r)}
            </td>
            <td className="px-4 py-2">
              <D value={r.periodStart} /> – <D value={r.periodEnd} />
            </td>
            <td className="px-4 py-2 capitalize">{r.status}</td>
            <td className="px-4 py-2 text-right">
              <Link href={`/payroll/salary-sheet/${r.id}`} className="text-xs text-gray-600 hover:underline">
                View
              </Link>
            </td>
          </tr>
        ))}
        {runs.length === 0 && (
          <tr>
            <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
              No payroll runs yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
