import { requireTenantSession } from "@/lib/session";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SignOutButton } from "./sign-out-button";
import { AppNav } from "./nav";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  {
    href: "/chart-of-accounts",
    label: "Chart of Accounts",
    children: [
      { href: "/chart-of-accounts", label: "Group" },
      { href: "/chart-of-accounts/sub-groups", label: "Sub-group" },
    ],
  },
  { href: "/customers", label: "Customers" },
  {
    href: "/sales",
    label: "Sales",
    children: [
      { href: "/sales", label: "Add new" },
      { href: "/sales/invoices", label: "Invoices" },
    ],
  },
  {
    href: "/purchases",
    label: "Purchases",
    children: [
      { href: "/purchases/consumable", label: "Consumable purchase" },
      { href: "/purchases/stockable", label: "Stockable purchase" },
    ],
  },
  { href: "/suppliers", label: "Suppliers" },
  {
    href: "/inventory",
    label: "Inventory",
    children: [
      { href: "/inventory/items", label: "Items" },
      { href: "/inventory/setup", label: "Setup" },
    ],
  },
  {
    href: "/payroll",
    label: "Payroll",
    children: [
      { href: "/payroll/employees", label: "Employees" },
      { href: "/payroll/attendance", label: "Attendance" },
      { href: "/payroll/salary-sheet", label: "Salary sheet" },
      { href: "/payroll/benefits", label: "Benefits" },
      { href: "/payroll/setup", label: "Setup" },
    ],
  },
  { href: "/journal", label: "Journal Entries" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireTenantSession();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">{tenant?.companyName}</p>
          <p className="text-xs text-gray-500">{session.role}</p>
        </div>
        <AppNav items={NAV} />
        <div className="px-2 py-3 border-t border-gray-200">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
