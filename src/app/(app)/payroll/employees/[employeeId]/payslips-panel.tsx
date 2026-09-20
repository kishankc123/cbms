type Payslip = {
  id: string;
  calendarSystem: string;
  month: number;
  year: number;
  status: string;
  basicSalary: string;
  grossPay: string;
  netPay: string;
};

import { payrollPeriodLabel } from "@/lib/payroll/period-label";

export function PayslipsPanel({ payslips }: { payslips: Payslip[] }) {
  return (
    <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
      <thead className="bg-gray-50 text-left text-gray-500">
        <tr>
          <th className="px-4 py-2 font-medium">Period</th>
          <th className="px-4 py-2 font-medium">Basic Salary</th>
          <th className="px-4 py-2 font-medium">Gross Pay</th>
          <th className="px-4 py-2 font-medium">Net Pay</th>
          <th className="px-4 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {payslips.map((p) => (
          <tr key={p.id} className="border-t border-gray-100">
            <td className="px-4 py-2">
              {payrollPeriodLabel(p)}
            </td>
            <td className="px-4 py-2">{Number(p.basicSalary).toFixed(2)}</td>
            <td className="px-4 py-2">{Number(p.grossPay).toFixed(2)}</td>
            <td className="px-4 py-2">{Number(p.netPay).toFixed(2)}</td>
            <td className="px-4 py-2 capitalize">{p.status}</td>
          </tr>
        ))}
        {payslips.length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
              No finalized payslips yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
