"use client";

import { useEffect, useId, useRef, useState } from "react";

/** A small ⓘ that opens a short explanation when clicked and closes on a click elsewhere or Esc. For notes people can skip; keep warnings as plain text. */
export function HelpTip({ children, label = "More information" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span ref={box} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[10px] font-semibold leading-none text-ink-2 hover:bg-hover"
      >
        i
      </button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[80vw] whitespace-normal rounded-md border border-line bg-surface p-2 text-left text-xs font-normal normal-case text-ink shadow-[var(--shadow-modal)]">
          {children}
        </span>
      )}
    </span>
  );
}
