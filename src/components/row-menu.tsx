"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; hidden?: boolean };

/**
 * A three-dot button that opens a small menu of row actions (View, Edit, Print, Void...). The menu is portalled and
 * positioned against the button, so a table's overflow never clips it; it flips upward near the bottom of the screen.
 */
export function RowMenu({ items, label = "Actions" }: { items: RowMenuItem[]; label?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ right: number; top: number; up: boolean } | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const height = visible.length * 34 + 12;
      const up = window.innerHeight - r.bottom < height + 8 && r.top > height;
      setPos({ right: Math.max(window.innerWidth - r.right, 8), top: up ? r.top : r.bottom, up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        <svg viewBox="0 0 4 16" className="h-4 w-1 fill-current" aria-hidden>
          <circle cx="2" cy="2" r="1.6" />
          <circle cx="2" cy="8" r="1.6" />
          <circle cx="2" cy="14" r="1.6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", right: pos.right, ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }) }}
            className="z-[70] min-w-[9rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg"
          >
            {visible.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`block w-full px-3 py-1.5 text-left hover:bg-gray-50 ${item.danger ? "text-red-600" : "text-gray-700"}`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
