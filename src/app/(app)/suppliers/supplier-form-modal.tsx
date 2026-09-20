"use client";

import { useEffect, useState, type ReactNode } from "react";

type Initial = {
  name: string;
  panNumber: string;
  phone: string;
  details: string;
  openingBalance: number;
};

export function SupplierFormModal({
  title,
  action,
  supplierId,
  initial,
  trigger,
}: {
  title: string;
  action: (formData: FormData) => void | Promise<void>;
  supplierId?: string;
  initial?: Initial;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drCr, setDrCr] = useState<"DR" | "CR">(initial && initial.openingBalance < 0 ? "DR" : "CR");

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
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form action={action} onSubmit={() => setOpen(false)} className="space-y-3">
              {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={initial?.name}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">PAN / VAT number</label>
                <input
                  name="panNumber"
                  defaultValue={initial?.panNumber}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Contact number</label>
                <input
                  name="phone"
                  defaultValue={initial?.phone}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Address</label>
                <input
                  name="details"
                  defaultValue={initial?.details}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Opening balance</label>
                <div className="flex gap-2">
                  <input
                    name="openingBalance"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={initial ? Math.abs(initial.openingBalance) || undefined : undefined}
                    className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <input type="hidden" name="openingBalanceType" value={drCr} readOnly />
                  <div className="flex rounded border border-gray-300 overflow-hidden text-sm shrink-0">
                    <button
                      type="button"
                      onClick={() => setDrCr("DR")}
                      className={`px-3 ${drCr === "DR" ? "bg-[var(--color-primary)] text-white" : "bg-white text-gray-600"}`}
                    >
                      DR
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrCr("CR")}
                      className={`px-3 ${drCr === "CR" ? "bg-[var(--color-primary)] text-white" : "bg-white text-gray-600"}`}
                    >
                      CR
                    </button>
                  </div>
                </div>
              </div>

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
