import { guardView } from "@/components/page-guard";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";

// Attendance is marked per employee (Employees > profile > Attendance tab) —
// this page is the entry point for picking which employee's attendance to
// open, since attendance always belongs to one employee's record.
export default async function AttendanceIndexPage() {
  const denied = await guardView("payroll");
  if (denied) return denied;
  const session = await requireTenantSession();
  const employeeList = await db
    .select()
    .from(employees)
    .where(eq(employees.tenantId, session.tenantId))
    .orderBy(asc(employees.employeeCode));

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" className="!mb-0" />
      <p className="text-sm text-gray-500">Select an employee to view or mark their attendance.</p>

      <table className="border-collapse text-[13px] w-full">
        <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Employee ID</th>
            <th className="px-2.5 py-1.5 font-medium">Full Name</th>
            <th className="px-2.5 py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {employeeList.map((e) => (
            <tr key={e.id} className="border-b border-line transition-colors hover:bg-hover">
              <td className="px-2.5 py-1.5 font-mono">{e.employeeCode}</td>
              <td className="px-2.5 py-1.5">{e.fullName}</td>
              <td className="px-2.5 py-1.5 text-right">
                <Link href={`/payroll/employees/${e.id}`} className="text-xs text-gray-600 hover:underline">
                  Open profile
                </Link>
              </td>
            </tr>
          ))}
          {employeeList.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
                No employees yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
