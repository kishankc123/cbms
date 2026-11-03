import { redirect } from "next/navigation";
import { requireUserSession } from "@/lib/session";
import { AppNav } from "@/app/(app)/nav";
import { UserMenu } from "@/app/(app)/user-menu";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { parseTheme, themeCookieName } from "@/lib/theme";
import { sidebarCookieName } from "@/lib/sidebar";
import type { NavIconKey } from "@/components/shell/icons";

// A platform admin manages the platform, not any one organization's books — this nav is deliberately flat
// (no per-org children) since nothing here is scoped to a tenant.
const NAV: { href: string; label: string; icon: NavIconKey }[] = [
  { href: "/admin", label: "Overview", icon: "dashboard" },
  { href: "/admin/organizations", label: "Organizations", icon: "organizations" },
  { href: "/admin/compliance", label: "Compliance Configuration", icon: "compliance" },
  { href: "/admin/setup", label: "Setup", icon: "settings" },
  { href: "/admin/users", label: "Users", icon: "customers" },
  { href: "/admin/email-log", label: "Sent mail", icon: "mail" },
  { href: "/admin/billing", label: "Billing", icon: "expenses" },
  { href: "/admin/audit-log", label: "Platform Audit Log", icon: "audit" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gated on the user's isPlatformAdmin flag alone — never on any organization membership. A platform admin
  // doesn't need to belong to (or have selected) an organization to be here.
  const user = await requireUserSession().catch(() => null);
  if (!user) redirect("/signed-out");
  if (!user.isPlatformAdmin) redirect("/select-organization");

  const store = await cookies();
  return (
    <AppShell
      initialCollapsed={store.get(sidebarCookieName)?.value === "collapsed"}
      brand={<p className="truncate text-xs font-semibold uppercase tracking-wide text-red-500">Platform Administration</p>}
      nav={<AppNav items={NAV} />}
      topRight={
        <>
          <div className="hidden sm:block">
            <ThemeToggle initial={parseTheme(store.get(themeCookieName)?.value)} />
          </div>
          <UserMenu name={user.name} email={user.email} extra={<ThemeToggle initial={parseTheme(store.get(themeCookieName)?.value)} />} />
        </>
      }
    >
      {/* Never let this be mistaken for any organization's own view — that mistake here is exactly what a
          platform admin screen must never allow. */}
      <div className="-mx-4 -mt-5 mb-5 border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 md:-mx-6 md:px-6">
        Platform administration — this view spans every organization on the platform, not one client&apos;s books.
      </div>
      {children}
    </AppShell>
  );
}
