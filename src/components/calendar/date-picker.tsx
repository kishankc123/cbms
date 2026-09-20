"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMonths,
  formatDate,
  isProjectedBs,
  monthCells,
  monthNames,
  parseDate,
  todayIso,
  WEEKDAYS_SHORT,
  yearBounds,
  ymdOf,
  type CalendarSystem,
} from "@/lib/calendar";
import { useCalendar } from "./calendar-provider";

type Props = {
  /** Stored value: AD ISO "YYYY-MM-DD", or "" when empty. */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Classes for the text box (so it can match its surroundings, e.g. a table cell). */
  className?: string;
  /** Adds a hidden input holding the ISO value, for plain <form action> submissions. */
  name?: string;
  id?: string;
  /** Force a calendar instead of the organization's. */
  calendar?: CalendarSystem;
};

const defaultInput = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm";

/**
 * The one date input for the whole app. It follows the organization's
 * calendar (AD or BS) for display, typing and the popup, but its value is
 * always the canonical AD ISO string — so nothing downstream ever sees BS.
 */
export function DatePicker({ value, onChange, min, max, required, disabled, placeholder, className, name, id, calendar: forced }: Props) {
  const orgCalendar = useCalendar();
  const calendar = forced ?? orgCalendar;
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDate(value, calendar));
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const today = todayIso();
  const seed = value || today;
  const seedYmd = ymdOf(calendar, seed) ?? ymdOf(calendar, today) ?? ymdOf("AD", today)!;
  const [view, setView] = useState({ year: seedYmd.year, month: seedYmd.month });

  // Keep the visible text in step with the stored value / calendar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(formatDate(value, calendar));
    setError(null);
  }, [value, calendar]);

  function position() {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const panelH = 330;
    const top = r.bottom + panelH > window.innerHeight && r.top > panelH ? r.top - panelH - 4 : r.bottom + 4;
    setPos({ top, left: Math.min(r.left, window.innerWidth - 272) });
  }

  useLayoutEffect(() => {
    if (open) position();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !inputRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const outOfBounds = (iso: string) => (min && iso < min ? `Date cannot be before ${formatDate(min, calendar)}.` : max && iso > max ? `Date cannot be after ${formatDate(max, calendar)}.` : null);

  function commit(iso: string) {
    const problem = outOfBounds(iso);
    if (problem) {
      setError(problem);
      return false;
    }
    setError(null);
    setDraft(formatDate(iso, calendar));
    onChange(iso);
    return true;
  }

  function commitDraft() {
    const text = draft.trim();
    if (text === "") {
      if (value !== "") onChange("");
      setError(null);
      return;
    }
    const r = parseDate(text, calendar);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!commit(r.iso)) return;
  }

  function openPanel() {
    if (disabled) return;
    const s = ymdOf(calendar, value || today) ?? seedYmd;
    setView({ year: s.year, month: s.month });
    setOpen(true);
  }

  function shift(months: number) {
    const cells = monthCells(calendar, view.year, view.month);
    const anchor = cells?.days[0].iso;
    if (!anchor) return;
    const next = ymdOf(calendar, addMonths(calendar, anchor, months));
    if (next) setView({ year: next.year, month: next.month });
  }

  const [minYear, maxYear] = yearBounds(calendar);
  const cells = useMemo(() => monthCells(calendar, view.year, view.month), [calendar, view.year, view.month]);
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i), [minYear, maxYear]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required={required}
        value={draft}
        placeholder={placeholder ?? (calendar === "BS" ? "DD-MM-YYYY (BS)" : "DD-MM-YYYY")}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={openPanel}
        onClick={openPanel}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
            setOpen(false);
          }
          if (e.key === "ArrowDown") openPanel();
        }}
        aria-invalid={error ? true : undefined}
        className={`${className ?? defaultInput} ${error ? "!border-red-400" : ""}`}
      />
      {name && <input type="hidden" name={name} value={value} />}
      {error && <p className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-white px-1 text-xs text-red-600">{error}</p>}

      {open &&
        pos &&
        createPortal(
          <div ref={panelRef} style={{ position: "fixed", top: pos.top, left: pos.left, width: 264 }} className="z-[70] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center gap-1">
              <button type="button" onClick={() => shift(-12)} className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Previous year">
                «
              </button>
              <button type="button" onClick={() => shift(-1)} className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Previous month">
                ‹
              </button>
              <select value={view.month} onChange={(e) => setView({ ...view, month: +e.target.value })} className="flex-1 rounded border border-gray-200 px-1 py-0.5 text-xs">
                {monthNames(calendar).map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select value={view.year} onChange={(e) => setView({ ...view, year: +e.target.value })} className="rounded border border-gray-200 px-1 py-0.5 text-xs">
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => shift(1)} className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Next month">
                ›
              </button>
              <button type="button" onClick={() => shift(12)} className="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100" aria-label="Next year">
                »
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-gray-400">
              {WEEKDAYS_SHORT.map((d) => (
                <div key={d} className="py-0.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells &&
                Array.from({ length: cells.leading }, (_, i) => <div key={`b${i}`} />)}
              {cells?.days.map(({ day, iso }) => {
                const blocked = Boolean((min && iso < min) || (max && iso > max));
                const selected = iso === value;
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      if (commit(iso)) setOpen(false);
                    }}
                    className={`h-8 rounded text-xs ${
                      selected ? "bg-[var(--color-primary)] text-white" : iso === today ? "border border-[var(--color-primary)] text-gray-900" : "text-gray-800 hover:bg-gray-100"
                    } disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {calendar === "BS" && cells && isProjectedBs(cells.days[0].iso) && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">BS dates this far ahead are projections and may be revised.</p>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (commit(today)) setOpen(false);
                }}
                className="text-[var(--color-primary)] hover:underline"
              >
                Today
              </button>
              {!required && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft("");
                    setError(null);
                    onChange("");
                    setOpen(false);
                  }}
                  className="text-gray-500 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * Uncontrolled variant for plain `<form action={serverAction}>` forms: keeps its
 * own state and submits the AD ISO value under `name`.
 */
export function DateField({ name, defaultValue = "", ...rest }: Omit<Props, "value" | "onChange" | "name"> & { name: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  return <DatePicker {...rest} name={name} value={value} onChange={setValue} />;
}
