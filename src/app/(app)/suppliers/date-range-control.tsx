"use client";

import { useEffect, useRef, useState } from "react";

import { DatePicker } from "@/components/calendar/date-picker";
import { useCalendar, useFormatDate } from "@/components/calendar/calendar-provider";
import { presetRange, type RangePreset } from "@/lib/calendar";
export type DateFilter = { mode: "all" | "range"; from: string; to: string };

export function DateRangeControl({
  value,
  onChange,
}: {
  value: DateFilter;
  onChange: (v: DateFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(value.from);
  const [draftTo, setDraftTo] = useState(value.to);
  const ref = useRef<HTMLDivElement>(null);
  const calendar = useCalendar();
  const fmtDate = useFormatDate();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = value.mode === "all" ? "All time" : `${fmtDate(value.from)} → ${fmtDate(value.to)}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface px-3 py-[5px] text-[13px] font-medium text-ink transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
      >
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg space-y-3">
          <button
            type="button"
            onClick={() => {
              onChange({ mode: "all", from: "", to: "" });
              setOpen(false);
            }}
            className={`w-full rounded px-2 py-1.5 text-left text-sm ${
              value.mode === "all" ? "bg-[var(--color-primary)] text-white" : "hover:bg-gray-100 text-gray-700"
            }`}
          >
            All time
          </button>

          <div className="flex flex-wrap gap-1.5">
            {([["this_month", "This month"], ["last_month", "Last month"], ["this_fiscal_year", "This fiscal year"]] as [RangePreset, string][]).map(([p, label]) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  const r = presetRange(p, calendar);
                  onChange({ mode: "range", from: r.from, to: r.to });
                  setOpen(false);
                }}
                className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">Custom range</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <DatePicker value={draftFrom} onChange={(v) => setDraftFrom(v)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <DatePicker value={draftTo} onChange={(v) => setDraftTo(v)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
              </div>
            </div>
            <button
              type="button"
              disabled={!draftFrom || !draftTo}
              onClick={() => {
                onChange({ mode: "range", from: draftFrom, to: draftTo });
                setOpen(false);
              }}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50 w-full"
            >
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
