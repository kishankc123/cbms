import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SignOutButton } from "./sign-out-button";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chart-of-accounts", label: "Chart of Accounts" },
  { href: "/customers", label: "Customers" },
  { href: "/sales", label: "Sales" },
  { href: "/journal", label: "Journal Entries" },
  { href: "/reports", label: "Reports" },
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
        <nav className="flex-1 px-2 py-3 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-200"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-2 py-3 border-t border-gray-200">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
