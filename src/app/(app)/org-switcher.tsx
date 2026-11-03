"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
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
        aria-expanded={open}
        title={active?.roleLabel}
        className="flex h-8 max-w-[9rem] items-center sm:max-w-[16rem] gap-1.5 rounded-md px-2 text-[13px] font-medium text-ink transition-colors hover:bg-hover disabled:opacity-60"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-semibold text-[var(--on-accent)]">{(active?.companyName ?? "O").slice(0, 1).toUpperCase()}</span>
        <span className="truncate">{active?.companyName ?? "Organization"}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-2" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-popover)]">
          <p className="px-3 py-1 text-xs font-medium text-gray-500">Switch Organization</p>
          {orgs.map((o) => (
            <button
              key={o.tenantId}
              type="button"
              onClick={() => choose(o.tenantId)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
            >
              <span className="flex h-5 w-3 items-center text-accent-text">{o.tenantId === activeId ? <Check size={14} /> : null}</span>
              <span>
                <span className="block text-sm text-gray-900">{o.companyName}</span>
                <span className="block text-xs text-gray-500">{o.roleLabel}</span>
              </span>
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <Link href="/create-organization" className="block px-3 py-1.5 text-sm text-[var(--accent-text)] hover:bg-gray-50">
              + Create new organization
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
