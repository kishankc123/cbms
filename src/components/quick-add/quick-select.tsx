"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Option = { id: string; name: string };

/**
 * A dropdown that looks like the app's other selects, with a "+ Add new" row pinned inside the list.
 * A native <select> can't hold a button, so this is a small custom listbox: type to filter, arrow keys
 * and Enter to choose, Escape to close. The list is portalled so table scroll containers never clip it.
 */
export function QuickSelect({
  value,
  options,
  onChange,
  onAddNew,
  placeholder,
  addLabel = "+ Add new",
  className,
  disabled,
}: {
  value: string;
  options: Option[];
  onChange: (id: string) => void;
  onAddNew: () => void;
  placeholder: string;
  addLabel?: string;
  /** Classes for the closed field, so it matches the selects around it. */
  className?: string;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);

  const selected = options.find((o) => o.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const room = window.innerHeight - r.bottom;
      const width = Math.max(r.width, 220);
      const left = Math.min(r.left, Math.max(window.innerWidth - width - 8, 8));
      setPos({ left, top: room < 280 && r.top > room ? r.top : r.bottom, width, up: room < 280 && r.top > room });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }
  function choose(id: string) {
    onChange(id);
    close();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active].id);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActive(Math.max(options.findIndex((o) => o.id === value), 0));
          setOpen((v) => !v);
        }}
        className={`flex items-center justify-between gap-1 text-left ${/(^|\s)w-/.test(className ?? "") ? "" : "w-full"} ${className ?? "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"}`}
      >
        <span className={`truncate ${selected ? "" : "text-gray-500"}`}>{selected ? selected.name : placeholder}</span>
        <svg viewBox="0 0 10 6" className="h-1.5 w-2.5 shrink-0 fill-none stroke-gray-500" strokeWidth="1.5" aria-hidden>
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            onKeyDown={onKeyDown}
            style={{ position: "fixed", left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top + 2 } : { top: pos.top + 2 }) }}
            className="z-[70] overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg"
          >
            {options.length > 6 && (
              <div className="border-b border-gray-100 p-1.5">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="Search…"
                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-[var(--color-primary)] focus:outline-none"
                />
              </div>
            )}
            <div className="max-h-56 overflow-y-auto py-1" tabIndex={-1}>
              <button type="button" role="option" aria-selected={!value} onClick={() => choose("")} className="block w-full px-3 py-1.5 text-left text-gray-400 hover:bg-gray-50">
                {placeholder}
              </button>
              {filtered.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.id)}
                  className={`block w-full truncate px-3 py-1.5 text-left ${i === active ? "bg-gray-100" : ""} ${o.id === value ? "font-medium text-gray-900" : "text-gray-700"}`}
                >
                  {o.name}
                </button>
              ))}
              {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No matches</p>}
            </div>
            <button
              type="button"
              onClick={() => {
                close();
                onAddNew();
              }}
              className="block w-full border-t border-gray-100 bg-gray-50/60 px-3 py-2 text-left text-sm font-medium text-[var(--color-primary)] hover:bg-gray-100"
            >
              {addLabel}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
