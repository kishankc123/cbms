import { redirect } from "next/navigation";
import { requireUserSession } from "@/lib/session";
import { AppNav } from "@/app/(app)/nav";
import { SignOutButton } from "@/app/(app)/sign-out-button";

// A platform admin manages the platform, not any one organization's books — this nav is deliberately flat
// (no per-org children) since nothing here is scoped to a tenant.
const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/compliance", label: "Compliance Configuration" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/audit-log", label: "Platform Audit Log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gated on the user's isPlatformAdmin flag alone — never on any organization membership. A platform admin
  // doesn't need to belong to (or have selected) an organization to be here.
  const user = await requireUserSession().catch(() => null);
  if (!user) redirect("/signed-out");
  if (!user.isPlatformAdmin) redirect("/select-organization");

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-[var(--sidebar-bg)] flex flex-col">
        <div className="px-4 py-4 border-b border-[var(--sidebar-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-400">Platform Administration</p>
          <p className="mt-1 text-sm text-white truncate">{user.email}</p>
        </div>
        <AppNav items={NAV} />
        <div className="px-2 py-3 border-t border-[var(--sidebar-border)]">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1">
        {/* Never let this be mistaken for any organization's own view — that mistake here is exactly what a
            platform admin screen must never allow. */}
        <div className="border-b border-red-200 bg-red-50 px-8 py-2 text-xs font-medium text-red-700">
          Platform administration — this view spans every organization on the platform, not one client&apos;s books.
        </div>
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
