"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/calendar";
import { useCalendar } from "@/components/calendar/calendar-provider";

const OpeningDateContext = createContext<string | null>(null);

/** Makes the organization's Inventory Opening Date available to every form that moves stock. */
export function InventoryProvider({ openingDate, children }: { openingDate: string | null; children: React.ReactNode }) {
  return <OpeningDateContext.Provider value={openingDate}>{children}</OpeningDateContext.Provider>;
}

export function useInventoryOpeningDate() {
  return useContext(OpeningDateContext);
}

/**
 * For a form that saves a document dated `date`: says at once when that date is before the Inventory Opening Date (`notice`, to
 * put under the date field), and `guard()` — called first thing when saving — stops the save and asks what to do: change the
 * transaction date, change the Inventory Opening Date, or cancel. `active` is whether the document touches stock at all.
 */
export function useOpeningDateGuard(date: string, active: boolean) {
  const opening = useInventoryOpeningDate();
  const calendar = useCalendar();
  const router = useRouter();
  const [prompt, setPrompt] = useState(false);
  const blocked = Boolean(active && opening && date && date < opening);
  const message = blocked ? `${formatDate(date, calendar)} is before the Inventory Opening Date of ${formatDate(opening as string, calendar)}. Review the transaction date or update the Inventory Opening Date.` : null;

  function guard() {
    if (!blocked) return true;
    setPrompt(true);
    return false;
  }

  const notice = (
    <>
      {message && <p className="mt-1 text-xs text-red-600">{message}</p>}
      {prompt && message && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPrompt(false)} />
          <div className="relative w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900">Transaction date is before the Inventory Opening Date</h2>
            <p className="text-sm text-gray-600">This transaction would fall outside the current inventory history.</p>
            <p className="text-sm text-gray-900">{message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setPrompt(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={() => router.push("/inventory/stock?tab=opening")} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Change Inventory Opening Date
              </button>
              <button type="button" onClick={() => setPrompt(false)} autoFocus className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
                Change transaction date
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { blocked, guard, notice };
}
