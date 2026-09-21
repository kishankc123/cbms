"use client";

import { useMemo, useState } from "react";
import { voidPurchaseReturn, getPurchaseReturnCredit, applyPurchaseReturnCredit, removePurchaseReturnCredit } from "./actions";
import { ApplyCreditModal } from "@/components/apply-credit-modal";

import { D } from "@/components/calendar/date-text";
type Vendor = { id: string; name: string };
type Note = {
  id: string;
  noteNumber: string;
  vendorId: string;
  noteDate: string;
  total: string;
  status: string;
};

type SortKey = "date" | "noteNumber" | "supplier" | "total" | "status";
type SortDir = "asc" | "desc";

export function PurchaseReturnsTable({
  noteList,
  vendorById,
}: {
  noteList: Note[];
  vendorById: Record<string, Vendor>;
}) {
  const [search, setSearch] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = !q
      ? noteList
      : noteList.filter(
          (n) =>
            n.noteNumber.toLowerCase().includes(q) ||
            (vendorById[n.vendorId]?.name ?? "").toLowerCase().includes(q) ||
            n.total.toLowerCase().includes(q)
        );

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.noteDate;
            bv = b.noteDate;
            break;
          case "noteNumber":
            av = a.noteNumber;
            bv = b.noteNumber;
            break;
          case "total":
            av = Number(a.total);
            bv = Number(b.total);
            break;
          case "status":
            av = a.status;
            bv = b.status;
            break;
          default:
            av = vendorById[a.vendorId]?.name ?? "";
            bv = vendorById[b.vendorId]?.name ?? "";
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [noteList, vendorById, search, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by supplier, credit note #, amount..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-72"
        />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("date")}
            >
              Date{sortIndicator("date")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("noteNumber")}
            >
              Credit note #{sortIndicator("noteNumber")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("supplier")}
            >
              Supplier{sortIndicator("supplier")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("total")}
            >
              Amount{sortIndicator("total")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("status")}
            >
              Status{sortIndicator("status")}
            </th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((n) => (
            <tr key={n.id} className="border-t border-gray-100">
              <td className="px-4 py-2"><D value={n.noteDate} /></td>
              <td className="px-4 py-2 font-mono">{n.noteNumber}</td>
              <td className="px-4 py-2">{vendorById[n.vendorId]?.name ?? "—"}</td>
              <td className="px-4 py-2">
                {Number(n.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="px-4 py-2 capitalize">{n.status}</td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                {n.status !== "void" && (
                  <button type="button" onClick={() => setApplyingId(n.id)} className="text-xs text-gray-600 hover:underline">
                    Apply credit
                  </button>
                )}
                {n.status !== "void" && (
                  <form
                    action={voidPurchaseReturn}
                    className="inline"
                    onSubmit={(e) => {
                      if (!confirm(`Void credit note ${n.noteNumber}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="noteId" value={n.id} />
                    <button type="submit" className="text-red-600 hover:underline text-xs">
                      Void
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No credit notes yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {applyingId && (
        <ApplyCreditModal
          title="Apply credit to bills"
          documentWord="bill"
          load={() => getPurchaseReturnCredit(applyingId)}
          onApply={(allocations) => applyPurchaseReturnCredit(applyingId, allocations)}
          onRemove={(id) => removePurchaseReturnCredit(id)}
          onClose={() => setApplyingId(null)}
        />
      )}
    </>
  );
}
