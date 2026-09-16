"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getCustomerHistory, type LedgerRow } from "./actions";

export function HistoryDrawer({
  customerId,
  customerName,
  trigger,
}: {
  customerId: string;
  customerName: string;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ openingBalance: number; rows: LedgerRow[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleOpen() {
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getCustomerHistory(customerId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

  return (
    <>
      {trigger(handleOpen)}

      <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{customerName}</h2>
              <p className="text-xs text-gray-500">Account history (Accounts Receivable)</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="p-5 overflow-y-auto" style={{ height: "calc(100% - 73px)" }}>
            {loading && <p className="text-sm text-gray-400">Loading...</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && !error && data && (
              <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Details</th>
                    <th className="px-4 py-2 font-medium">Debit</th>
                    <th className="px-4 py-2 font-medium">Credit</th>
                    <th className="px-4 py-2 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-100 bg-gray-50/50">
                    <td className="px-4 py-2 text-gray-500">—</td>
                    <td className="px-4 py-2 text-gray-500">Opening balance</td>
                    <td className="px-4 py-2">{data.openingBalance > 0 ? fmt(data.openingBalance) : ""}</td>
                    <td className="px-4 py-2">{data.openingBalance < 0 ? fmt(Math.abs(data.openingBalance)) : ""}</td>
                    <td className="px-4 py-2 font-medium">{fmt(data.openingBalance)}</td>
                  </tr>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-4 py-2">{r.date}</td>
                      <td className="px-4 py-2">{r.details}</td>
                      <td className="px-4 py-2">{r.debit > 0 ? fmt(r.debit) : ""}</td>
                      <td className="px-4 py-2">{r.credit > 0 ? fmt(r.credit) : ""}</td>
                      <td className="px-4 py-2 font-medium">{fmt(r.balance)}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                        No transactions yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
