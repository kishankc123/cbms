"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; hidden?: boolean };

/**
 * A three-dot button that opens a small menu of row actions (View, Edit, Print, Void...). The menu is portalled and
 * positioned against the button, so a table's overflow never clips it; it flips upward near the bottom of the screen.
 *
 * The same menu also opens from the row itself, which is easier with a thumb: double-click or double-tap anywhere on the row, or swipe the row to the left.
 * A double-click, double-tap or swipe that starts on a button, link or field does what that control does instead, and a row that opens
 * its details when tapped keeps doing that.
 */
export function RowMenu({ items, label = "Actions", onOpen }: { items: RowMenuItem[]; label?: string; /** What a double-tap, double-click or swipe on the row does instead of opening this menu (the details pop-up of an invoice or bill). */ onOpen?: () => void }) {
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

  // Opening the menu from the row: double-click, double-tap or a swipe to the left.
  useEffect(() => {
    const row = buttonRef.current?.closest("tr");
    // A row that already opens its details on a tap has a main action of its own; the gestures stay out of its way.
    if (!row || row.classList.contains("cursor-pointer")) return;
    const interactive = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest("button, a, input, select, textarea, label, [role=menuitem]"));
    const openFromRow = () => {
      window.getSelection()?.removeAllRanges();
      if (onOpen) onOpen();
      else setOpen(true);
    };
    const onDouble = (e: MouseEvent) => {
      if (!interactive(e.target)) openFromRow();
    };
    let start: { x: number; y: number; t: number } | null = null;
    let lastTap = 0;
    const onStart = (e: TouchEvent) => {
      const p = e.touches[0];
      start = e.touches.length === 1 && !interactive(e.target) ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      const took = Date.now() - start.t;
      start = null;
      if (dx < -60 && Math.abs(dy) < 40 && took < 700) return openFromRow();
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && took < 300) {
        const now = Date.now();
        if (now - lastTap < 350) {
          lastTap = 0;
          openFromRow();
        } else lastTap = now;
      }
    };
    const touchAction = row.style.touchAction;
    row.style.touchAction = "manipulation";
    row.addEventListener("dblclick", onDouble);
    row.addEventListener("touchstart", onStart, { passive: true });
    row.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      row.style.touchAction = touchAction;
      row.removeEventListener("dblclick", onDouble);
      row.removeEventListener("touchstart", onStart);
      row.removeEventListener("touchend", onEnd);
    };
  }, [onOpen]);

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
