import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";

// Attendance is marked per employee (Employees > profile > Attendance tab) —
// this page is the entry point for picking which employee's attendance to
// open, since attendance always belongs to one employee's record.
export default async function AttendanceIndexPage() {
  const session = await requireTenantSession();
  const employeeList = await db
    .select()
    .from(employees)
    .where(eq(employees.tenantId, session.tenantId))
    .orderBy(asc(employees.employeeCode));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Attendance</h1>
      <p className="text-sm text-gray-500">Select an employee to view or mark their attendance.</p>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Employee ID</th>
            <th className="px-4 py-2 font-medium">Full Name</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {employeeList.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-mono">{e.employeeCode}</td>
              <td className="px-4 py-2">{e.fullName}</td>
              <td className="px-4 py-2 text-right">
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
