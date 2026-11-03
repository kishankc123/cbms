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
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${active ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
