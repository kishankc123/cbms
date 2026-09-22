import { redirect } from "next/navigation";
import { requireTenantSession, requireUserSession, TenantScopeError } from "@/lib/session";
import { listActiveMemberships } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";
import { SignOutButton } from "./sign-out-button";
import { AppNav } from "./nav";
import { OrgSwitcher } from "./org-switcher";
import { VerifyBanner } from "./verify-banner";
import { CalendarProvider } from "@/components/calendar/calendar-provider";
import { InventoryProvider } from "@/components/inventory/opening-date";
import { getOpeningDate } from "@/lib/inventory/stock";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  {
    href: "/chart-of-accounts",
    label: "Chart of Accounts",
    children: [
      { href: "/chart-of-accounts", label: "Group" },
      { href: "/chart-of-accounts/sub-groups", label: "Sub-group" },
      { href: "/chart-of-accounts/structure", label: "Structure" },
    ],
  },
  { href: "/customers", label: "Customers" },
  { href: "/sales", label: "Sales" },
  {
    href: "/return",
    label: "Return",
    children: [
      { href: "/return/sales", label: "Sales return" },
      { href: "/return/purchase", label: "Purchase return" },
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
  { href: "/expenses", label: "Expenses" },
  {
    href: "/payments",
    label: "Payments",
    children: [
      { href: "/payments/money-in", label: "Money In" },
      { href: "/payments/money-out", label: "Money Out" },
      { href: "/payments/inter-transfer", label: "Inter-Transfer" },
    ],
  },
  {
    href: "/inventory",
    label: "Inventory",
    children: [
      { href: "/inventory/items", label: "Items" },
      { href: "/inventory/stock", label: "Stock" },
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
  {
    href: "/bank-reconciliation",
    label: "Bank Reconciliation",
    children: [
      { href: "/bank-reconciliation", label: "Reconciliation" },
      { href: "/bank-reconciliation/setup", label: "Bank Accounts" },
    ],
  },
  {
    href: "/compliance",
    label: "Compliance",
    children: [
      { href: "/compliance", label: "Overview" },
      { href: "/compliance/company", label: "Company Details" },
      { href: "/compliance/ownership", label: "Ownership & Capital" },
      { href: "/compliance/tax", label: "Tax Compliance" },
      { href: "/compliance/statutory", label: "Statutory Compliance" },
      { href: "/compliance/calendar", label: "Compliance Calendar" },
      { href: "/compliance/history", label: "Compliance History" },
    ],
  },
  {
    href: "/audit",
    label: "Audit",
    children: [
      { href: "/audit", label: "Overview" },
      { href: "/audit/rules", label: "Rules & Policies" },
      { href: "/audit/exceptions", label: "Exception Centre" },
      { href: "/audit/periods", label: "Period Locking" },
      { href: "/audit/audit-trail", label: "Audit Trail" },
    ],
  },
  { href: "/journal", label: "Journal Entries" },
  {
    href: "/reports",
    label: "Reports",
    children: [
      { href: "/reports", label: "Financial Reports" },
      { href: "/reports/ledger", label: "Ledger" },
    ],
  },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Resolve the session first; redirect() must not run inside a try/catch.
  let session: Awaited<ReturnType<typeof requireTenantSession>> | null = null;
  let failure: "no-org" | "invalid" | null = null;
  try {
    session = await requireTenantSession();
  } catch (e) {
    failure = e instanceof TenantScopeError ? "no-org" : "invalid";
  }
  if (failure === "no-org") redirect("/select-organization");
  if (!session) redirect("/signed-out");

  const user = await requireUserSession();
  const orgs = await listActiveMemberships(user.id);
  const inventoryOpeningDate = await getOpeningDate(session.tenantId);

  return (
    <CalendarProvider calendar={session.calendar}>
    <InventoryProvider openingDate={inventoryOpeningDate}>
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-[var(--sidebar-bg)] flex flex-col">
        <div className="px-3 py-4 border-b border-[var(--sidebar-border)]">
          <OrgSwitcher
            orgs={orgs.map((o) => ({ tenantId: o.tenantId, companyName: o.companyName, roleLabel: roleLabel(o.role) }))}
            activeId={session.tenantId}
          />
        </div>
        <AppNav items={NAV} />
        <div className="px-2 py-3 border-t border-[var(--sidebar-border)]">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">
        {!user.emailVerifiedAt && <VerifyBanner />}
        {children}
      </main>
    </div>
    </InventoryProvider>
    </CalendarProvider>
  );
}
