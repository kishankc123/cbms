"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// The dashboard's tabs. Each is its own page, so only the one that is open loads its figures. The chosen period travels with you
// from tab to tab (the from and to dates in the address).
const TABS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/cash-flow", label: "Cash flow" },
  { href: "/dashboard/upcoming", label: "Upcoming" },
  { href: "/dashboard/forecast", label: "Forecast" },
  { href: "/dashboard/planning", label: "Planning" },
] as const;

export function DashboardTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const period = new URLSearchParams();
  for (const key of ["from", "to"]) {
    const v = params.get(key);
    if (v) period.set(key, v);
  }
  const query = period.toString();

  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={query ? `${t.href}?${query}` : t.href}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${active ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
