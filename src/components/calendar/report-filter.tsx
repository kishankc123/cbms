"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { presetRange, todayIso, type DateRange, type RangePreset } from "@/lib/calendar";
import { useCalendar } from "./calendar-provider";
import { DatePicker } from "./date-picker";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_fiscal_year", label: "This fiscal year" },
];

/**
 * Report date filter. The user enters dates in the organization's calendar (via
 * the DatePicker) but only AD ISO dates ever leave it: they go into the URL as
 * `from` / `to`, and every query compares AD dates. Presets follow the
 * organization's calendar, so "This month" is the current BS month for BS orgs.
 */
export function ReportFilter({
  from,
  to,
  fiscal,
  asOfOnly = false,
  children,
}: {
  from: string;
  to: string;
  fiscal: DateRange | null;
  /** Only an "as of" date is relevant (balance-type reports). */
  asOfOnly?: boolean;
  /** Extra controls (e.g. account picker, Date Display) placed in the same bar. */
  children?: React.ReactNode;
}) {
  const calendar = useCalendar();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  function apply(f: string, t: string) {
    const next = new URLSearchParams(params.toString());
    next.set("from", f);
    next.set("to", t);
    router.push(`${pathname}?${next.toString()}`);
  }

  function applyPreset(p: RangePreset) {
    const r = presetRange(p, calendar, todayIso(), fiscal);
    setDraftFrom(r.from);
    setDraftTo(r.to);
    apply(r.from, r.to);
  }

  const invalid = !draftTo || (!asOfOnly && (!draftFrom || draftFrom > draftTo));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
      {children}
      {!asOfOnly && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <DatePicker value={draftFrom} onChange={setDraftFrom} max={draftTo || undefined} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 mb-1">{asOfOnly ? "As of" : "To"}</label>
        <DatePicker value={draftTo} onChange={setDraftTo} min={!asOfOnly ? draftFrom || undefined : undefined} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <button
        type="button"
        disabled={invalid}
        onClick={() => apply(asOfOnly ? draftTo : draftFrom, draftTo)}
        className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-40"
      >
        Apply
      </button>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => applyPreset(p.key)} className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
