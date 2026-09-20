"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { switchOrganization } from "../select-organization/actions";

type Org = { tenantId: string; companyName: string; roleLabel: string };

export function OrgSwitcher({ orgs, activeId }: { orgs: Org[]; activeId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = orgs.find((o) => o.tenantId === activeId);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(id: string) {
    if (id === activeId) return setOpen(false);
    // The action switches the session server-side and redirects; the full
    // navigation afterwards discards every piece of the old organization's
    // client-side state.
    startTransition(async () => {
      await switchOrganization(id);
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="w-full text-left rounded px-1 py-1 hover:bg-[var(--sidebar-bg-hover)] disabled:opacity-60"
      >
        <p className="flex items-center justify-between text-sm font-semibold text-white">
          <span className="truncate">{active?.companyName ?? "Organization"}</span>
          <span className="ml-2 text-[10px] text-[var(--sidebar-text)]">▼</span>
        </p>
        <p className="text-xs text-[var(--sidebar-text)]">{active?.roleLabel}</p>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <p className="px-3 py-1 text-xs font-medium text-gray-500">Switch Organization</p>
          {orgs.map((o) => (
            <button
              key={o.tenantId}
              type="button"
              onClick={() => choose(o.tenantId)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
            >
              <span className="w-3 text-sm text-[var(--color-primary)]">{o.tenantId === activeId ? "✓" : ""}</span>
              <span>
                <span className="block text-sm text-gray-900">{o.companyName}</span>
                <span className="block text-xs text-gray-500">{o.roleLabel}</span>
              </span>
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <Link href="/create-organization" className="block px-3 py-1.5 text-sm text-[var(--color-primary)] hover:bg-gray-50">
              + Create new organization
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
