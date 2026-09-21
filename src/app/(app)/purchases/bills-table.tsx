"use client";

import { useMemo, useState } from "react";
import { voidBill, getBillAdvance, applyBillAdvance, removeBillAdvance } from "./actions";
import { ApplyAdvanceModal } from "@/components/apply-advance-modal";

import { D } from "@/components/calendar/date-text";
import { todayIso } from "@/lib/calendar";
type Vendor = { id: string; name: string };
type Bill = {
  id: string;
  billNumber: string;
  vendorId: string | null;
  description: string | null;
  billDate: string;
  dueDate?: string | null;
  total: string;
  status: string;
};

// An unpaid or part-paid bill past its due date shows as overdue. Derived, not stored, so it can't go stale.
function shownStatus(b: Bill, today: string) {
  const open = b.status === "open" || b.status === "partially_paid" || b.status === "draft";
  return open && b.dueDate && b.dueDate < today ? "overdue" : b.status;
}

type SortKey = "date" | "billNumber" | "supplier" | "total" | "status";
type SortDir = "asc" | "desc";

export function BillsTable({
  vendors,
  bills,
  onEdit,
}: {
  vendors: Vendor[];
  bills: Bill[];
  onEdit?: (billId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [advanceId, setAdvanceId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const today = todayIso();

  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = !q
      ? bills
      : bills.filter(
          (b) =>
            b.billNumber.toLowerCase().includes(q) ||
            (vendorById.get(b.vendorId ?? "")?.name ?? b.description ?? "").toLowerCase().includes(q) ||
            b.total.toLowerCase().includes(q)
        );

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.billDate;
            bv = b.billDate;
            break;
          case "billNumber":
            av = a.billNumber;
            bv = b.billNumber;
            break;
          case "total":
            av = Number(a.total);
            bv = Number(b.total);
            break;
          case "status":
            av = shownStatus(a, today);
            bv = shownStatus(b, today);
            break;
          default:
            av = vendorById.get(a.vendorId ?? "")?.name ?? a.description ?? "";
            bv = vendorById.get(b.vendorId ?? "")?.name ?? b.description ?? "";
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return rows;
  }, [bills, search, vendorById, sortKey, sortDir, today]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by supplier, bill #, amount..."
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
              onClick={() => toggleSort("billNumber")}
            >
              Bill #{sortIndicator("billNumber")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("supplier")}
            >
              Supplier / Details{sortIndicator("supplier")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("total")}
            >
              Total{sortIndicator("total")}
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
          {filtered.map((b) => (
            <tr key={b.id} className="border-t border-gray-100">
              <td className="px-4 py-2"><D value={b.billDate} /></td>
              <td className="px-4 py-2 font-mono">{b.billNumber}</td>
              <td className="px-4 py-2">{vendorById.get(b.vendorId ?? "")?.name ?? b.description ?? "—"}</td>
              <td className="px-4 py-2">{Number(b.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td className={`px-4 py-2 capitalize ${shownStatus(b, today) === "overdue" ? "font-medium text-red-600" : ""}`}>{shownStatus(b, today).replace("_", " ")}</td>
              <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                {b.vendorId && (b.status === "open" || b.status === "partially_paid" || b.status === "overdue") && (
                  <button type="button" onClick={() => setAdvanceId(b.id)} className="text-xs text-gray-600 hover:underline">
                    Apply advance
                  </button>
                )}
                {b.status !== "void" && onEdit && (
                  <button type="button" onClick={() => onEdit(b.id)} className="text-xs text-gray-600 hover:underline">
                    Edit
                  </button>
                )}
                {b.status !== "void" && (
                  <form
                    action={voidBill}
                    className="inline"
                    onSubmit={(e) => {
                      if (!confirm(`Void bill ${b.billNumber}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="billId" value={b.id} />
                    <button type="submit" className="text-red-600 hover:underline text-xs">
                      Void
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No bills yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {advanceId && (
        <ApplyAdvanceModal
          title="Apply supplier advance"
          documentWord="bill"
          partyWord="supplier"
          load={() => getBillAdvance(advanceId)}
          onApply={(amount) => applyBillAdvance(advanceId, amount)}
          onRemove={(id) => removeBillAdvance(id)}
          onClose={() => setAdvanceId(null)}
        />
      )}
    </div>
  );
}
