"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createCustomer } from "./actions";
import { CustomerFormModal } from "./customer-form-modal";
import { DateRangeControl, type DateFilter } from "./date-range-control";

type Customer = {
  id: string;
  name: string;
  phone: string;
  details: string;
  openingBalance: number;
  invoices: { date: string; total: number }[];
  receipts: { date: string; amount: number }[];
};

type SortField = "name" | "outstanding";

function computePeriod(c: Customer, filter: DateFilter) {
  const isBeforeFrom = (date: string) => filter.mode === "range" && !!filter.from && date < filter.from;
  const inRange = (date: string) => {
    if (filter.mode === "all") return true;
    if (filter.from && date < filter.from) return false;
    if (filter.to && date > filter.to) return false;
    return true;
  };

  const opening =
    c.openingBalance +
    c.invoices.filter((i) => isBeforeFrom(i.date)).reduce((s, i) => s + i.total, 0) -
    c.receipts.filter((r) => isBeforeFrom(r.date)).reduce((s, r) => s + r.amount, 0);

  const sales = c.invoices.filter((i) => inRange(i.date)).reduce((s, i) => s + i.total, 0);
  const paid = c.receipts.filter((r) => inRange(r.date)).reduce((s, r) => s + r.amount, 0);
  const outstanding = opening + sales - paid;

  return { opening, sales, paid, outstanding };
}

export function CustomersTable({ customers }: { customers: Customer[] }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: "all", from: "", to: "" });

  const rows = useMemo(
    () => customers.map((c) => ({ ...c, ...computePeriod(c, dateFilter) })),
    [customers, dateFilter]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q))
      .sort((a, b) => {
        const cmp = sortField === "name" ? a.name.localeCompare(b.name) : a.outstanding - b.outstanding;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [rows, search, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-64"
        />
        <div className="flex items-center gap-2">
          <DateRangeControl value={dateFilter} onChange={setDateFilter} />
          <CustomerFormModal
            title="Add customer"
            action={createCustomer}
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
              >
                Add customer
              </button>
            )}
          />
        </div>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <SortableHeader label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <th className="px-4 py-2 font-medium">Opening</th>
            <th className="px-4 py-2 font-medium">Sales</th>
            <th className="px-4 py-2 font-medium">Paid</th>
            <SortableHeader
              label="Outstanding (AR)"
              field="outstanding"
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{c.name}</td>
              <td className="px-4 py-2">{fmt(c.opening)}</td>
              <td className="px-4 py-2">{fmt(c.sales)}</td>
              <td className="px-4 py-2">{fmt(c.paid)}</td>
              <td className="px-4 py-2">{fmt(c.outstanding)}</td>
              <td className="px-4 py-2">
                <Link href={`/customers/${c.id}`} className="text-xs text-[var(--color-primary)] hover:underline">
                  View profile
                </Link>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No customers match
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: "asc" | "desc";
  onSort: (field: SortField) => void;
}) {
  const active = field === sortField;
  return (
    <th className="px-4 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`flex items-center gap-1 hover:text-gray-900 ${active ? "text-gray-900" : ""}`}
      >
        {label}
        <span className="text-[10px] w-3 inline-block">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}
