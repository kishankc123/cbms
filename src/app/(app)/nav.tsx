"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { NAV_ICONS, type NavIconKey } from "@/components/shell/icons";
import { useSidebar } from "@/components/shell/app-shell";

type NavChild = { href: string; label: string };
type NavItem = { href: string; label: string; icon: NavIconKey; children?: NavChild[] };

// A group's own page can have sibling routes not literally listed as children (e.g. Product's Items/Stock/Setup
// switch via their own pill tabs, not the sidebar) — matching by prefix keeps the group open and highlighted for
// any page under it, not just the ones spelled out below.
const underGroup = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// What is shown beside an icon in the collapsed sidebar: the module's name, or for a group its name and its pages.
type Flyout = { href: string; top: number };

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { collapsed } = useSidebar();
  const [openHref, setOpenHref] = useState<string | null>(
    () => items.find((item) => item.children?.some((c) => pathname === c.href) || (item.children && underGroup(pathname, item.href)))?.href ?? null
  );
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Labels are hidden only on a wide screen where the sidebar is collapsed; the mobile drawer always shows them.
  const hideLabel = collapsed ? "md:hidden" : "";

  const show = (href: string, el: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setFlyout({ href, top: el.getBoundingClientRect().top });
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyout(null), 120);
  };
  const keep = () => closeTimer.current && clearTimeout(closeTimer.current);

  const rowClass = (active: boolean) =>
    `relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors duration-100 hover:bg-[var(--sidebar-bg-hover)] ${
      collapsed ? "md:mx-auto md:w-8 md:justify-center md:px-0" : ""
    } ${active ? "bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-text-active)]" : "text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)]"}`;

  const marker = (active: boolean) => (active ? <span aria-hidden className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" /> : null);
  const iconOf = (key: NavIconKey, active: boolean) => {
    const Icon = NAV_ICONS[key] ?? NAV_ICONS.dashboard;
    return <Icon size={16} strokeWidth={1.75} className={`shrink-0 ${active ? "text-accent-text" : ""}`} />;
  };

  const flyoutItem = flyout ? items.find((i) => i.href === flyout.href) : null;

  return (
    <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        if (!item.children) {
          const isActive = item.href === "/" ? pathname === "/" : pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-label={collapsed ? item.label : undefined} aria-current={isActive ? "page" : undefined} className={rowClass(isActive)} onMouseEnter={(e) => collapsed && show(item.href, e.currentTarget)} onMouseLeave={hide} onFocus={(e) => collapsed && show(item.href, e.currentTarget)} onBlur={hide}>
              {marker(isActive)}
              {iconOf(item.icon, isActive)}
              <span className={`truncate ${hideLabel}`}>{item.label}</span>
            </Link>
          );
        }

        const isOpen = openHref === item.href;
        const isSectionActive = item.children.some((c) => pathname === c.href) || underGroup(pathname, item.href);

        return (
          <div key={item.href}>
            <button
              type="button"
              aria-expanded={collapsed ? undefined : isOpen}
              aria-label={collapsed ? item.label : undefined}
              onClick={(e) => (collapsed ? show(item.href, e.currentTarget) : setOpenHref(isOpen ? null : item.href))}
              onMouseEnter={(e) => collapsed && show(item.href, e.currentTarget)}
              onMouseLeave={hide}
              className={rowClass(isSectionActive && (collapsed || !isOpen))}
            >
              {marker(isSectionActive)}
              {iconOf(item.icon, isSectionActive)}
              <span className={`flex-1 truncate text-left ${hideLabel}`}>{item.label}</span>
              <ChevronDown size={14} className={`shrink-0 text-[var(--sidebar-text)] transition-transform duration-150 ${isOpen ? "" : "-rotate-90"} ${hideLabel}`} />
            </button>
            {isOpen && (
              <div className={`ml-[15px] mt-0.5 space-y-px border-l border-[var(--sidebar-border)] pl-2 ${collapsed ? "md:hidden" : ""}`}>
                {item.children.map((child) => {
                  const isChildActive = pathname === child.href;
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      aria-current={isChildActive ? "page" : undefined}
                      className={`flex h-7 items-center rounded-md px-2 text-[13px] transition-colors duration-100 hover:bg-[var(--sidebar-bg-hover)] ${
                        isChildActive ? "bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-text-active)]" : "text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)]"
                      }`}
                    >
                      <span className="truncate">{child.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {collapsed && flyout && flyoutItem && (
        <div
          role="menu"
          onMouseEnter={keep}
          onMouseLeave={hide}
          style={{ top: flyout.top, left: "calc(var(--sidebar-width-collapsed) + 0.25rem)" }}
          className="fixed z-[60] hidden min-w-40 rounded-lg border border-line bg-surface py-1 text-[13px] shadow-[var(--shadow-popover)] md:block"
        >
          {flyoutItem.children ? (
            <>
              <p className="px-3 py-1 text-xs font-medium text-ink-2">{flyoutItem.label}</p>
              {flyoutItem.children.map((c) => (
                <Link key={c.href} href={c.href} role="menuitem" onClick={() => setFlyout(null)} className={`block px-3 py-1.5 hover:bg-hover ${pathname === c.href ? "font-medium text-accent-text" : "text-ink"}`}>
                  {c.label}
                </Link>
              ))}
            </>
          ) : (
            <p className="px-3 py-1 font-medium text-ink">{flyoutItem.label}</p>
          )}
        </div>
      )}
    </nav>
  );
}
