"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setActiveFiscalYear } from "./fiscal-year-actions";

type FY = { id: string; code: string; status: "open" | "closed" | "reopened" };

export function FiscalYearSwitcher({
  years,
  activeId,
  isAllTime,
  suggestedCode,
}: {
  years: FY[];
  activeId: string | null;
  isAllTime: boolean;
  /** The current fiscal year's code, computed but not yet added as a real row — set only when
   * `activeId` is null and `isAllTime` is false (see (app)/layout.tsx). */
  suggestedCode?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const active = years.find((y) => y.id === activeId);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(value: string) {
    setOpen(false);
    startTransition(async () => {
      await setActiveFiscalYear(value);
      router.refresh();
    });
  }

  const label = isAllTime ? "All Time" : (active?.code ?? suggestedCode ?? "Fiscal Year");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className="w-full text-left rounded px-1 py-1 hover:bg-[var(--sidebar-bg-hover)] disabled:opacity-60"
      >
        <p className="flex items-center justify-between text-xs text-[var(--sidebar-text)]">
          <span className="truncate">FY {label}</span>
          <span className="ml-2 text-[10px]">▼</span>
        </p>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <p className="px-3 py-1 text-xs font-medium text-gray-500">Fiscal Year</p>
          {years.length === 0 && suggestedCode && (
            <div className="px-3 py-1.5">
              <p className="text-sm text-gray-900">{suggestedCode} — not yet added</p>
              <Link href="/settings/fiscal-years" className="text-xs text-[var(--color-primary)] hover:underline" onClick={() => setOpen(false)}>
                Add it in Settings →
              </Link>
            </div>
          )}
          {years.map((y) => (
            <button key={y.id} type="button" onClick={() => choose(y.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50">
              <span className="w-3 text-sm text-[var(--color-primary)]">{y.id === activeId && !isAllTime ? "✓" : ""}</span>
              <span className="text-sm text-gray-900">{y.code}</span>
              {y.status !== "open" && <span className="text-xs text-gray-400">— {y.status === "closed" ? "Closed" : "Reopened"}</span>}
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button type="button" onClick={() => choose("all_time")} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50">
              <span className="w-3 text-sm text-[var(--color-primary)]">{isAllTime ? "✓" : ""}</span>
              <span className="text-sm text-gray-900">All Fiscal Years</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
