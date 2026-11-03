"use client";

import { useEffect } from "react";

// Generic confirmation popup for a completed create action — a message and a
// single OK button, used after Items/Units/Groups/Categories are saved.
export function InfoDialog({ message, onOk }: { message: string; onOk: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter") onOk();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOk]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onOk} />

      <div className="relative w-full max-w-sm rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)] space-y-4 text-center">
        <p className="text-sm text-gray-900">{message}</p>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onOk}
            autoFocus
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
