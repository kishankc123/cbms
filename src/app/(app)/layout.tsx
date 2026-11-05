import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { can, requireTenantSession, requireUserSession, TenantScopeError } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { listActiveMemberships } from "@/lib/memberships";
import { AppNav } from "./nav";
import { OrgSwitcher } from "./org-switcher";
import { FiscalYearSwitcher } from "./fiscal-year-switcher";
import { getActiveFiscalYear, listFiscalYears } from "@/lib/fiscal";
import { VerifyBanner } from "./verify-banner";
import { verificationEmailProblem } from "@/lib/email-log";
import { AddNoticeBanner } from "@/components/add-notice-banner";
import { listAddNotices } from "@/lib/org-members";
import { CalendarProvider } from "@/components/calendar/calendar-provider";
import { InventoryProvider } from "@/components/inventory/opening-date";
import { getOpeningDate, getTrackInventory } from "@/lib/inventory/stock";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppShell } from "@/components/shell/app-shell";
import type { NavIconKey } from "@/components/shell/icons";
import { UserMenu } from "./user-menu";
import { Logo } from "@/components/brand/logo";
import { sidebarCookieName } from "@/lib/sidebar";
import { themeCookieName, parseTheme } from "@/lib/theme";

const NAV: NavEntry[] = [
  { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
  {
    href: "/chart-of-accounts",
    icon: "chart",
    label: "Chart of Accounts",
    children: [
      { href: "/chart-of-accounts", label: "Group" },
      { href: "/chart-of-accounts/sub-groups", label: "Sub-group" },
      { href: "/chart-of-accounts/structure", label: "Structure" },
    ],
  },
  { href: "/customers", icon: "customers", label: "Customers" },
  { href: "/sales", icon: "sales", label: "Sales" },
  {
    href: "/return",
    icon: "returns",
    label: "Return",
    children: [
      { href: "/return/sales", label: "Sales return" },
      { href: "/return/purchase", label: "Purchase return" },
    ],
  },
  {
    href: "/purchases",
    icon: "purchases",
    label: "Purchases",
    children: [
      { href: "/purchases/consumable", label: "Consumable purchase" },
      { href: "/purchases/stockable", label: "Stockable purchase" },
    ],
  },
  { href: "/suppliers", icon: "suppliers", label: "Suppliers" },
  {
    href: "/expenses",
    icon: "expenses",
    label: "Expenses",
    children: [
      { href: "/expenses", label: "One-off Expenses" },
      { href: "/expenses/recurring", label: "Recurring Expenses" },
    ],
  },
  {
    href: "/payments",
    icon: "payments",
    label: "Payments",
    children: [
      { href: "/payments/money-in", label: "Money In" },
      { href: "/payments/money-out", label: "Money Out" },
      { href: "/payments/cheques", label: "Issued Cheques" },
      { href: "/payments/cheques-received", label: "Received Cheques" },
      { href: "/payments/inter-transfer", label: "Inter-Transfer" },
    ],
  },
  {
    href: "/inventory",
    icon: "inventory",
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
    icon: "assets",
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
    icon: "payroll",
    label: "Payroll",
    children: [
      { href: "/payroll", label: "Overview" },
      { href: "/payroll/employees", label: "Employees" },
      { href: "/payroll/structure", label: "Salary structure" },
      { href: "/payroll/salary-sheet", label: "Payroll processing" },
      { href: "/payroll/contributions", label: "Contributions" },
      { href: "/payroll/tax", label: "Tax configuration" },
      { href: "/payroll/reports", label: "Reports" },
      { href: "/payroll/setup", label: "Settings" },
    ],
  },
  {
    href: "/bank-reconciliation",
    icon: "bank",
    label: "Bank Reconciliation",
    children: [
      { href: "/bank-reconciliation", label: "Home" },
      { href: "/bank-reconciliation/setup", label: "Link bank account" },
      { href: "/reports/bank-reconciliation-report", label: "Reports" },
    ],
  },
  {
    href: "/compliance",
    icon: "compliance",
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
    icon: "audit",
    label: "Audit",
    children: [
      { href: "/audit", label: "Overview" },
      { href: "/audit/rules", label: "Rules & Policies" },
      { href: "/audit/exceptions", label: "Exception Centre" },
      { href: "/audit/periods", label: "Period Locking" },
      { href: "/audit/audit-trail", label: "Audit Trail" },
    ],
  },
  { href: "/journal", icon: "journal", label: "Journal Entries" },
  {
    href: "/reports",
    icon: "reports",
    label: "Reports",
    // One child today — Financial Reports, covering everything actually built (P&L, Balance Sheet, Trial
    // Balance, Ledger) via the /reports landing page. As the other categories in the spec get built
    // (Sales & Receivables, Inventory, Payroll, ...), add one child per category here the same way
    // Inventory and Compliance already do — this dropdown is where that growth happens.
    children: [{ href: "/reports", label: "Financial Reports" }],
  },
  {
    href: "/settings",
    icon: "settings",
    label: "Settings",
    children: [
      { href: "/settings/company", label: "Company details" },
      { href: "/settings/general", label: "General" },
      { href: "/settings/fiscal-years", label: "Fiscal years" },
      { href: "/settings/opening-balances", label: "Opening balances" },
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

type NavEntry = { href: string; label: string; icon: NavIconKey; children?: { href: string; label: string }[] };

/** Only what this person may open: a group with no visible children disappears with them. */
function visibleNav(items: NavEntry[], session: Awaited<ReturnType<typeof requireTenantSession>>, trackInventory: boolean): NavEntry[] {
  const allowed = (access: string | undefined) => !access || (access === "admin" ? isOrgAdmin(session.role) : can(session, access, "view"));
  return items
    .map((original) => {
      // An organization that does not keep stock has one Purchases entry: bills are entered by amount.
      const item = !trackInventory && original.href === "/purchases" ? { ...original, children: [{ href: "/purchases/stockable", label: "Purchases" }] } : original;
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
  const [orgs, notices, inventoryOpeningDate, trackInventory, activeFiscalYear, fiscalYearsList, cookieStore] = await Promise.all([
    listActiveMemberships(user.id),
    listAddNotices(user.id),
    getOpeningDate(session.tenantId),
    getTrackInventory(session.tenantId),
    getActiveFiscalYear(session.tenantId),
    listFiscalYears(session.tenantId),
    cookies(),
  ]);
  const activeTheme = parseTheme(cookieStore.get(themeCookieName)?.value);
  const sidebarCollapsed = cookieStore.get(sidebarCookieName)?.value === "collapsed";

  return (
    <CalendarProvider calendar={session.calendar}>
    <InventoryProvider openingDate={inventoryOpeningDate}>
    <AppShell
      initialCollapsed={sidebarCollapsed}
      brand={<Logo tone="dark" className="text-[var(--sidebar-text-active)]" />}
      nav={<AppNav items={visibleNav(NAV, session, trackInventory)} />}
      topLeft={
        <>
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
        </>
      }
      topRight={
        <>
          <div className="hidden sm:block">
            <ThemeToggle initial={activeTheme} />
          </div>
          <UserMenu name={user.name} email={user.email} detail={session.roleName ?? undefined} extra={<ThemeToggle initial={activeTheme} />} />
        </>
      }
    >
      <AddNoticeBanner notices={notices} activeTenantId={session.tenantId} />
      {!user.emailVerifiedAt && <VerifyBanner emailProblem={await verificationEmailProblem(user.email)} />}
      {children}
    </AppShell>
    </InventoryProvider>
    </CalendarProvider>
  );
}
