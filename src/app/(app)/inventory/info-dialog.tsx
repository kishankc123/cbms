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
      <div className="absolute inset-0 bg-black/30" onClick={onOk} />

      <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4 text-center">
        <p className="text-sm text-gray-900">{message}</p>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onOk}
            autoFocus
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-6 py-1.5"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
