"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Real page navigations, not client-side tab-swap, so each screen keeps its own existing data fetching untouched —
// this only changes how you move between them. Shared across Items, Stock and Setup (the Product section).
const TABS = [
  { href: "/inventory/items", label: "Items" },
  { href: "/inventory/stock", label: "Stock" },
  { href: "/inventory/setup", label: "Setup" },
] as const;

export function ProductTabs() {
  const pathname = usePathname();
  return (
    <div className="inline-flex rounded-full bg-gray-100 p-1">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${active ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
