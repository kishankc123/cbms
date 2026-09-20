"use client";

import { useEffect, useState } from "react";
import { formatDate, type CalendarSystem, type DateDisplayMode } from "@/lib/calendar";

// Shared building blocks for reports and ledgers that must be able to show the
// AD and BS date of the SAME transaction side by side. Both columns are derived
// from the one stored AD date at render time — nothing is stored twice.

export type DateDisplay = DateDisplayMode;
const KEY = "cbms.dateDisplay";

/** The user's chosen report date display, remembered in this browser. Default: AD + BS. */
export function useDateDisplay(): [DateDisplay, (mode: DateDisplay) => void] {
  const [mode, setMode] = useState<DateDisplay>("BOTH");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Read after mount so server and first client render agree (localStorage is browser-only).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "AD" || saved === "BS" || saved === "BOTH") setMode(saved);
    } catch {
      /* storage unavailable — keep default */
    }
  }, []);
  return [
    mode,
    (next) => {
      setMode(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
    },
  ];
}

export function DateDisplayControl({ value, onChange, label = "Date Display" }: { value: DateDisplay; onChange: (m: DateDisplay) => void; label?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as DateDisplay)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
        <option value="AD">AD Only</option>
        <option value="BS">BS Only</option>
        <option value="BOTH">AD + BS</option>
      </select>
    </div>
  );
}

const cals = (mode: DateDisplay): CalendarSystem[] => (mode === "BOTH" ? ["AD", "BS"] : [mode]);

export function DateHead({ mode, label = "Date", className = "px-4 py-2 font-medium" }: { mode: DateDisplay; label?: string; className?: string }) {
  return (
    <>
      {cals(mode).map((c) => (
        <th key={c} className={className}>
          {mode === "BOTH" ? `${label} (${c})` : label}
        </th>
      ))}
    </>
  );
}

export function DateCells({ mode, value, className = "px-4 py-2" }: { mode: DateDisplay; value: string | null | undefined; className?: string }) {
  return (
    <>
      {cals(mode).map((c) => (
        <td key={c} className={`${className} whitespace-nowrap`}>
          {formatDate(value, c)}
        </td>
      ))}
    </>
  );
}

/** Number of columns the date takes, for colSpan maths. */
export const dateColumnCount = (mode: DateDisplay) => (mode === "BOTH" ? 2 : 1);

