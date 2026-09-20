"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { updateAccount } from "./actions";
import { ACCOUNT_SUB_CATEGORIES, guessSubCategory } from "@/lib/ledger/account-sub-categories";

type Initial = {
  id: string;
  name: string;
  isActive: boolean;
  category?: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory?: string | null;
  system?: boolean;
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [isActive, setIsActive] = useState(initial.isActive);
  // A legacy value that isn't one of the fixed options falls back to a same-type option instead of the first one.
  const matched =
    initial.subCategory && ACCOUNT_SUB_CATEGORIES.some((sc) => sc.label === initial.subCategory)
      ? initial.subCategory
      : initial.category
        ? guessSubCategory(initial.category, initial.subCategory)
        : "";
  const [subCategory, setSubCategory] = useState(matched);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await updateAccount({ id: initial.id, name, isActive, ...(showSubCategory ? { subCategory } : {}) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {trigger(() => setOpen(true))}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Edit account</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            {initial.system && <p className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">System account: other parts of the system rely on it, so it can be renamed but not deleted, deactivated or moved to another type.</p>}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>

              {showSubCategory && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Category</label>
                  <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
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
                <input type="checkbox" checked={isActive} disabled={initial.system} onChange={(e) => setIsActive(e.target.checked)} />
                Active
              </label>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={busy || !name.trim()} onClick={save} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
