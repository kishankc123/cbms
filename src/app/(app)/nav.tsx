"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
};

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [openHref, setOpenHref] = useState<string | null>(
    () => items.find((item) => item.children?.some((c) => pathname === c.href))?.href ?? null
  );

  return (
    <nav className="flex-1 px-2 py-3 space-y-1">
      {items.map((item) => {
        if (!item.children) {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm hover:bg-gray-200 ${
                isActive ? "text-gray-900 font-medium" : "text-gray-700"
              }`}
            >
              {item.label}
            </Link>
          );
        }

        const isOpen = openHref === item.href;
        const isSectionActive = pathname === item.href || item.children.some((c) => pathname === c.href);

        return (
          <div key={item.href}>
            <button
              type="button"
              onClick={() => setOpenHref(isOpen ? null : item.href)}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm hover:bg-gray-200 ${
                isSectionActive ? "text-gray-900 font-medium" : "text-gray-700"
              }`}
            >
              {item.label}
              <svg
                viewBox="0 0 12 8"
                className={`h-2.5 w-2.5 fill-current transition-transform ${isOpen ? "" : "-rotate-90"}`}
              >
                <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
            {isOpen && (
              <div className="ml-3 mt-1 space-y-1 border-l border-gray-200 pl-3">
                {item.children.map((child) => {
                  const isChildActive = pathname === child.href;
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`block rounded px-2 py-1.5 text-sm hover:bg-gray-200 ${
                        isChildActive ? "text-gray-900 font-medium" : "text-gray-600"
                      }`}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
