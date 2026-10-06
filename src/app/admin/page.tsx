import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { getAdminOverview } from "./actions";
import { AdminHeader, adminCard } from "./ui";

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const c = await getAdminOverview();
  const card = (title: string, value: number, note: string, href: string) => (
    <Link href={href} className={`${adminCard} block p-4 hover:border-[var(--color-primary)]`}>
      <p className="text-xs text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{note}</p>
    </Link>
  );
  return (
    <div className="space-y-6 p-8">
      <AdminHeader title="Platform Administration" description="Everyone and every organization on the platform." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {card("Registered users", c.users.total, `${c.users.unverified} not verified · ${c.users.disabled} disabled`, "/admin/users")}
        {card("Platform administrators", c.users.admins, "Accounts with platform access", "/admin/users?admins=1")}
        {card("Organizations", c.orgs.total, `${c.orgs.active} active · ${c.orgs.suspended} suspended`, "/admin/organizations")}
        {card("Suspended organizations", c.orgs.suspended, "Members can't sign in to these", "/admin/organizations?status=suspended")}
      </div>
    </div>
  );
}
