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
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
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
                <DatePicker value={draftFrom} onChange={(v) => setDraftFrom(v)} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <DatePicker value={draftTo} onChange={(v) => setDraftTo(v)} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </div>
            </div>
            <button
              type="button"
              disabled={!draftFrom || !draftTo}
              onClick={() => {
                onChange({ mode: "range", from: draftFrom, to: draftTo });
                setOpen(false);
              }}
              className="w-full rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-3 py-1.5 disabled:opacity-40"
            >
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
