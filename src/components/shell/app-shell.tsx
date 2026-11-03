"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { LabelLinks } from "./label-links";

const SidebarContext = createContext({ collapsed: false });
/** Whether the sidebar is showing icons only (desktop). The drawer on a small screen is always the full menu. */
export const useSidebar = () => useContext(SidebarContext);

const COOKIE = "sidebar";

/**
 * The frame every signed-in page sits in: a collapsible sidebar, a slim top bar and the page area. The sidebar's state is
 * kept in a cookie, so the server renders it already collapsed or open and nothing jumps on load. Under 768px the sidebar
 * is a drawer opened from the top bar.
 */
export function AppShell({
  initialCollapsed,
  brand,
  nav,
  footer,
  topLeft,
  topRight,
  children,
}: {
  initialCollapsed: boolean;
  brand: React.ReactNode;
  nav: React.ReactNode;
  footer?: React.ReactNode;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawer, setDrawer] = useState(false);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <LabelLinks />
      <div className="flex min-h-screen bg-app">
        {drawer && <div className="fixed inset-0 z-40 bg-[var(--bg-overlay)] md:hidden" onClick={() => setDrawer(false)} aria-hidden />}
        <aside
          // A link followed inside the drawer closes it.
          onClickCapture={(e) => (e.target as HTMLElement).closest("a") && setDrawer(false)}
          className={`fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-width)] flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-[width] duration-150 ease-[var(--ease)] md:sticky md:top-0 md:z-20 md:h-screen md:self-start ${
            collapsed ? "md:w-[var(--sidebar-width-collapsed)]" : ""
          } ${drawer ? "" : "max-md:-translate-x-full"}`}
        >
          <div className={`flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-[var(--sidebar-border)] px-3 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
            <div className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>{brand}</div>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-text)] transition-colors hover:bg-[var(--sidebar-bg-hover)] hover:text-[var(--sidebar-text-active)] md:flex"
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--sidebar-text)] hover:bg-[var(--sidebar-bg-hover)] md:hidden">
              <X size={16} />
            </button>
          </div>
          {nav}
          {footer}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-5">
            <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover md:hidden">
              <Menu size={16} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-1">{topLeft}</div>
            <div className="flex shrink-0 items-center gap-2">{topRight}</div>
          </header>
          <main className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
