type Payslip = {
  id: string;
  calendarSystem: string;
  month: number;
  year: number;
  status: string;
  basicSalary: string;
  grossPay: string;
  advanceRecovered: string;
  tdsAmount: string;
  tdsDetail: unknown;
  netPay: string;
};

import Link from "next/link";
import { payrollPeriodLabel } from "@/lib/payroll/period-label";
import type { TdsWorking } from "@/lib/payroll/salary-tax-calc";
import { TdsCell } from "../../tds-working";

export function PayslipsPanel({ payslips }: { payslips: Payslip[] }) {
  return (
    <table className="border-collapse text-[13px] w-full">
      <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
        <tr>
          <th className="px-2.5 py-1.5 font-medium">Period</th>
          <th className="px-2.5 py-1.5 font-medium">Basic Salary</th>
          <th className="px-2.5 py-1.5 font-medium">Gross Pay</th>
          <th className="px-2.5 py-1.5 font-medium">TDS</th>
          <th className="px-2.5 py-1.5 font-medium">Advance Recovered</th>
          <th className="px-2.5 py-1.5 font-medium">Net Pay</th>
          <th className="px-2.5 py-1.5 font-medium">Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {payslips.map((p) => (
          <tr key={p.id} className="border-b border-line transition-colors hover:bg-hover">
            <td className="px-2.5 py-1.5">
              {payrollPeriodLabel(p)}
            </td>
            <td className="px-2.5 py-1.5">{Number(p.basicSalary).toFixed(2)}</td>
            <td className="px-2.5 py-1.5">{Number(p.grossPay).toFixed(2)}</td>
            <td className="px-2.5 py-1.5">
              <TdsCell amount={Number(p.tdsAmount)} working={(p.tdsDetail as TdsWorking | null) ?? null} title={payrollPeriodLabel(p)} />
            </td>
            <td className="px-2.5 py-1.5">{Number(p.advanceRecovered).toFixed(2)}</td>
            <td className="px-2.5 py-1.5">{Number(p.netPay).toFixed(2)}</td>
            <td className="px-2.5 py-1.5 capitalize">{p.status}</td>
            <td className="px-2.5 py-1.5 text-right">
              <Link href={`/payroll/payslips/${p.id}`} className="text-xs text-accent hover:underline">
                View payslip
              </Link>
            </td>
          </tr>
        ))}
        {payslips.length === 0 && (
          <tr>
            <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
              No finalized payslips yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
