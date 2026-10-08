import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { can, requireTenantSession, requireUserSession, TenantScopeError } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { listActiveMemberships } from "@/lib/memberships";
import { SignOutButton } from "./sign-out-button";
import { AppNav } from "./nav";
import { OrgSwitcher } from "./org-switcher";
import { FiscalYearSwitcher } from "./fiscal-year-switcher";
import { getActiveFiscalYear, listFiscalYears } from "@/lib/fiscal";
import { VerifyBanner } from "./verify-banner";
import { AddNoticeBanner } from "@/components/add-notice-banner";
import { listAddNotices } from "@/lib/org-members";
import { CalendarProvider } from "@/components/calendar/calendar-provider";
import { InventoryProvider } from "@/components/inventory/opening-date";
import { getOpeningDate } from "@/lib/inventory/stock";
import { ThemeToggle } from "@/components/theme-toggle";
import { themeCookieName, parseTheme } from "@/lib/theme";

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
  {
    href: "/expenses",
    label: "Expenses",
    children: [
      { href: "/expenses", label: "One-off Expenses" },
      { href: "/expenses/recurring", label: "Recurring Expenses" },
    ],
  },
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
      { href: "/inventory/items", label: "Product" },
      { href: "/inventory/services", label: "Services" },
      { href: "/inventory/saas", label: "SaaS" },
      { href: "/inventory/other", label: "Other" },
    ],
  },
  {
    href: "/assets",
    label: "Assets",
    children: [
      { href: "/assets", label: "Asset list" },
      { href: "/assets/depreciation", label: "Depreciation" },
      { href: "/assets/transactions", label: "Purchase / Sell asset" },
      { href: "/assets/setup", label: "Setup" },
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
      { href: "/compliance/penalties", label: "Fines & Penalties" },
      { href: "/compliance/statutory", label: "Statutory Compliance" },
      { href: "/compliance/catch-up", label: "Compliance Checklist" },
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
    // One child today — Financial Reports, covering everything actually built (P&L, Balance Sheet, Trial
    // Balance, Ledger) via the /reports landing page. As the other categories in the spec get built
    // (Sales & Receivables, Inventory, Payroll, ...), add one child per category here the same way
    // Inventory and Compliance already do — this dropdown is where that growth happens.
    children: [{ href: "/reports", label: "Financial Reports" }],
  },
  {
    href: "/settings",
    label: "Settings",
    children: [
      { href: "/settings/company", label: "Company details" },
      { href: "/settings/general", label: "General" },
      { href: "/settings/fiscal-years", label: "Fiscal years" },
      { href: "/settings/users", label: "Users" },
      { href: "/settings/roles", label: "Roles" },
      { href: "/settings/payment-modes", label: "Payment modes" },
    ],
  },
];

// Which module's View each sidebar entry needs (children inherit their parent's unless listed). "admin" means Owner or
// Administrator only. Entries not listed (Dashboard, Reports) are shown to everyone; each report checks its own module.
const NAV_ACCESS: Record<string, string> = {
  "/chart-of-accounts": "chart_of_accounts",
  "/customers": "sales",
  "/sales": "sales",
  "/return/sales": "sales",
  "/return/purchase": "purchases",
  "/purchases": "purchases",
  "/suppliers": "purchases",
  "/expenses": "expenses",
  "/payments": "payments",
  "/inventory": "inventory",
  "/assets": "assets",
  "/payroll": "payroll",
  "/bank-reconciliation": "bank_reconciliation",
  "/compliance": "compliance",
  "/audit": "audit",
  "/journal": "chart_of_accounts",
  "/settings": "settings",
  "/settings/users": "admin",
  "/settings/roles": "admin",
  "/settings/payment-modes": "admin",
};

type NavEntry = { href: string; label: string; children?: { href: string; label: string }[] };

/** Only what this person may open: a group with no visible children disappears with them. */
function visibleNav(items: NavEntry[], session: Awaited<ReturnType<typeof requireTenantSession>>): NavEntry[] {
  const allowed = (access: string | undefined) => !access || (access === "admin" ? isOrgAdmin(session.role) : can(session, access, "view"));
  return items
    .map((item) => {
      if (!item.children) return allowed(NAV_ACCESS[item.href]) ? item : null;
      const own = NAV_ACCESS[item.href];
      const children = item.children.filter((c) => allowed(NAV_ACCESS[c.href] ?? own));
      if (children.length === 0) return null;
      // The parent itself has no page of its own to open when it is only a group, so its own access is the children's.
      return { ...item, children };
    })
    .filter((x): x is NavEntry => x !== null);
}

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
  // Independent reads, so run them together. (getActiveFiscalYear never writes — fiscal years are
  // only created explicitly in Settings — so listFiscalYears can't race an auto-create.)
  const [orgs, notices, inventoryOpeningDate, activeFiscalYear, fiscalYearsList, cookieStore] = await Promise.all([
    listActiveMemberships(user.id),
    listAddNotices(user.id),
    getOpeningDate(session.tenantId),
    getActiveFiscalYear(session.tenantId),
    listFiscalYears(session.tenantId),
    cookies(),
  ]);
  const activeTheme = parseTheme(cookieStore.get(themeCookieName)?.value);

  return (
    <CalendarProvider calendar={session.calendar}>
    <InventoryProvider openingDate={inventoryOpeningDate}>
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-[var(--sidebar-bg)] flex flex-col">
        <div className="px-3 py-4 border-b border-[var(--sidebar-border)]">
          <OrgSwitcher
            orgs={orgs.map((o) => ({ tenantId: o.tenantId, companyName: o.companyName, roleLabel: o.roleName }))}
            activeId={session.tenantId}
          />
          <FiscalYearSwitcher
            years={fiscalYearsList}
            activeId={"id" in activeFiscalYear ? activeFiscalYear.id : null}
            isAllTime={"allTime" in activeFiscalYear}
            suggestedCode={"suggested" in activeFiscalYear ? activeFiscalYear.code : null}
          />
        </div>
        <AppNav items={visibleNav(NAV, session)} />
        <div className="px-2 py-3 border-t border-[var(--sidebar-border)] flex items-center justify-between gap-2">
          <SignOutButton />
          <ThemeToggle initial={activeTheme} />
        </div>
      </aside>
      <main className="flex-1 p-8">
        <AddNoticeBanner notices={notices} activeTenantId={session.tenantId} />
        {!user.emailVerifiedAt && <VerifyBanner />}
        {children}
      </main>
    </div>
    </InventoryProvider>
    </CalendarProvider>
  );
}
