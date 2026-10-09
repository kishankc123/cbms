"use client";

import { useEffect, useRef } from "react";

/** Confirms, after a save, that the invoices are saved. Closes with OK, Enter, Esc or a click outside. */
export function SavedDialog({ title, lines, onClose }: { title: string; lines: string[]; onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ok.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-700">✓</span>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        </div>
        <div className="space-y-0.5 text-sm text-gray-600">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        <div className="flex justify-end">
          <button ref={ok} type="button" onClick={onClose} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
