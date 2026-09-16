"use client";

import { useMemo, useState } from "react";

type Account = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  isActive: boolean;
};

const CATEGORIES = ["asset", "liability", "equity", "income", "expense"] as const;
type SortField = "code" | "name" | "category";

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    return accounts
      .filter((a) => categoryFilter === "all" || a.category === categoryFilter)
      .filter(
        (a) =>
          statusFilter === "all" ||
          (statusFilter === "active" ? a.isActive : !a.isActive)
      )
      .sort((a, b) => {
        const cmp = a[sortField].localeCompare(b[sortField]);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [accounts, categoryFilter, statusFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Filter by category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Filter by status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {(categoryFilter !== "all" || statusFilter !== "all") && (
          <button
            type="button"
            onClick={() => {
              setCategoryFilter("all");
              setStatusFilter("all");
            }}
            className="text-sm text-gray-500 hover:text-gray-900 pb-1.5"
          >
            Clear filters
          </button>
        )}
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <SortableHeader label="Code" field="code" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader
              label="Category"
              field="category"
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.id} className="border-t border-gray-100">
              <td className="px-4 py-2 font-mono">{a.code}</td>
              <td className="px-4 py-2">{a.name}</td>
              <td className="px-4 py-2 capitalize">{a.category}</td>
              <td className="px-4 py-2">{a.isActive ? "Active" : "Inactive"}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                No accounts match these filters
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
