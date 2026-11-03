"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Tabs: an underline under the active one, in the accent colour. `Tabs` switches content on the page; `LinkTabs` moves
// between routes and follows the address.

const TAB_BASE = "relative inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors duration-100";
const tabClass = (active: boolean) => `${TAB_BASE} ${active ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
const Count = ({ n }: { n?: number }) => (n === undefined ? null : <span className="rounded bg-surface-2 px-1.5 text-[11px] leading-4 text-ink-2">{n}</span>);

export type TabItem = { id: string; label: string; count?: number };

export function Tabs({ items, value, onChange, className = "" }: { items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b border-line ${className}`}>
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={tabClass(value === t.id)}>
          {t.label}
          <Count n={t.count} />
        </button>
      ))}
    </div>
  );
}

export function LinkTabs({ items, className = "" }: { items: { href: string; label: string; count?: number }[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={`flex gap-1 overflow-x-auto border-b border-line ${className}`}>
      {items.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
            {t.label}
            <Count n={t.count} />
          </Link>
        );
      })}
    </nav>
  );
}
