import { D } from "@/components/calendar/date-text";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";

export type StaffAdvanceRow = {
  id: string;
  advanceDate: string;
  forCalendar: string;
  forMonth: number;
  forYear: number;
  amount: number;
  recovered: number;
  status: string;
};

const fmt = (n: number) => n.toFixed(2);

// Money paid to this employee ahead of salary, and how much payroll has taken back so far. New advances are recorded in
// Payments > Money out > Staff Advance.
export function AdvancesPanel({ advances }: { advances: StaffAdvanceRow[] }) {
  const live = advances.filter((a) => a.status !== "void");
  const given = live.reduce((s, a) => s + a.amount, 0);
  const recovered = live.reduce((s, a) => s + a.recovered, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Advances given", given],
          ["Recovered through payroll", recovered],
          ["Still to recover", given - recovered],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label as string}</p>
            <p className="text-lg font-semibold text-gray-900">{fmt(value as number)}</p>
          </div>
        ))}
      </div>
      <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Taken against</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 text-right font-medium">Recovered</th>
            <th className="px-4 py-2 text-right font-medium">Remaining</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {advances.map((a) => {
            const remaining = a.status === "void" ? 0 : a.amount - a.recovered;
            return (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="px-4 py-2"><D value={a.advanceDate} /></td>
                <td className="px-4 py-2">{payrollPeriodLabel({ calendarSystem: a.forCalendar, month: a.forMonth, year: a.forYear })}</td>
                <td className="px-4 py-2 text-right">{fmt(a.amount)}</td>
                <td className="px-4 py-2 text-right">{fmt(a.recovered)}</td>
                <td className="px-4 py-2 text-right">{fmt(remaining)}</td>
                <td className="px-4 py-2">{a.status === "void" ? "Voided" : remaining <= 0.005 ? "Recovered" : a.recovered > 0 ? "Partly recovered" : "Open"}</td>
              </tr>
            );
          })}
          {advances.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No staff advances yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
