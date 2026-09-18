"use client";

import { useEffect, useState, type ReactNode } from "react";
import { updateAccount } from "./actions";
import { ACCOUNT_SUB_CATEGORIES, guessSubCategory } from "@/lib/ledger/account-sub-categories";

type Initial = {
  id: string;
  name: string;
  isActive: boolean;
  category?: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory?: string | null;
};

export function AccountEditModal({
  initial,
  showSubCategory,
  trigger,
}: {
  initial: Initial;
  showSubCategory: boolean;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // The initial value may not (or, for legacy free-text sub-categories, will
  // not) match one of the fixed options below — falling through to the first
  // option in that case would silently recategorize the account on save. Fall
  // back to a same-category option instead, or leave it unselected.
  const matchedSubCategory =
    initial.subCategory && ACCOUNT_SUB_CATEGORIES.some((sc) => sc.label === initial.subCategory)
      ? initial.subCategory
      : initial.category
        ? guessSubCategory(initial.category, initial.subCategory)
        : "";

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      {trigger(() => setOpen(true))}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Edit account</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form action={updateAccount} onSubmit={() => setOpen(false)} className="space-y-3">
              <input type="hidden" name="id" value={initial.id} />

              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={initial.name}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>

              {showSubCategory && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Category</label>
                  <select
                    name="subCategory"
                    required
                    defaultValue={matchedSubCategory}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="" disabled>
                      Select category
                    </option>
                    {ACCOUNT_SUB_CATEGORIES.map((sc) => (
                      <option key={sc.label} value={sc.label}>
                        {sc.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="isActive" defaultChecked={initial.isActive} />
                Active
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
