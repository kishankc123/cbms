"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";
import { formatDate, presetRange, todayIso, type DateRange, type RangePreset } from "@/lib/calendar";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { DatePicker } from "@/components/calendar/date-picker";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_fiscal_year", label: "This fiscal year" },
];

// One quiet button that shows the period, sitting on the tabs row. It opens a small panel with the quick ranges and, below them,
// a custom range. Dates are kept in the address (from and to), so the choice follows you from tab to tab.
export function DashboardPeriod({ from, to, fiscal }: { from: string; to: string; fiscal: DateRange | null }) {
  const calendar = useCalendar();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const today = todayIso();
  const matched = PRESETS.find((p) => {
    const r = presetRange(p.key, calendar, today, fiscal);
    return r.from === from && r.to === to;
  });
  const label = matched ? matched.label : `${formatDate(from, calendar, "short")} – ${formatDate(to, calendar, "short")}`;

  function apply(f: string, t: string) {
    const next = new URLSearchParams(params.toString());
    next.set("from", f);
    next.set("to", t);
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`);
  }

  const invalid = !draftFrom || !draftTo || draftFrom > draftTo;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          // Opening always starts the custom range from the period now on screen.
          setDraftFrom(from);
          setDraftTo(to);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${controlClass} inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-hover`}
      >
        <CalendarDays size={14} className="text-ink-2" />
        <span className="font-medium">{label}</span>
        {matched && <span className="hidden text-ink-2 sm:inline">· {formatDate(from, calendar, "short")} – {formatDate(to, calendar, "short")}</span>}
        <ChevronDown size={14} className="text-ink-2" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Choose period" className="absolute right-0 top-full z-50 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-popover)]">
            <ul className="grid grid-cols-2 gap-1">
              {PRESETS.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => {
                      const r = presetRange(p.key, calendar, today, fiscal);
                      apply(r.from, r.to);
                    }}
                    className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${matched?.key === p.key ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
                  >
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-2 text-xs font-medium text-ink-2">Custom range</p>
              <div className="flex items-center gap-2">
                <DatePicker value={draftFrom} onChange={setDraftFrom} max={draftTo || undefined} className={`${controlClass} w-full`} />
                <span className="text-ink-2">–</span>
                <DatePicker value={draftTo} onChange={setDraftTo} min={draftFrom || undefined} className={`${controlClass} w-full`} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button type="button" size="sm" disabled={invalid} onClick={() => apply(draftFrom, draftTo)}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
