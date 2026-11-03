"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
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
        aria-expanded={open}
        title="Financial year"
        className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink-2 transition-colors hover:bg-hover disabled:opacity-60"
      >
        <span className="whitespace-nowrap">FY {label}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-line bg-surface py-1 shadow-[var(--shadow-popover)]">
          <p className="px-3 py-1 text-xs font-medium text-gray-500">Fiscal Year</p>
          {years.length === 0 && suggestedCode && (
            <div className="px-3 py-1.5">
              <p className="text-sm text-gray-900">{suggestedCode} — not yet added</p>
              <Link href="/settings/fiscal-years" className="text-xs text-[var(--accent-text)] hover:underline" onClick={() => setOpen(false)}>
                Add it in Settings →
              </Link>
            </div>
          )}
          {years.map((y) => (
            <button key={y.id} type="button" onClick={() => choose(y.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50">
              <span className="flex h-5 w-3 items-center text-accent-text">{y.id === activeId && !isAllTime ? <Check size={14} /> : null}</span>
              <span className="text-sm text-gray-900">{y.code}</span>
              {y.status !== "open" && <span className="text-xs text-gray-400">— {y.status === "closed" ? "Closed" : "Reopened"}</span>}
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button type="button" onClick={() => choose("all_time")} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50">
              <span className="flex h-5 w-3 items-center text-accent-text">{isAllTime ? <Check size={14} /> : null}</span>
              <span className="text-sm text-gray-900">All Fiscal Years</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
