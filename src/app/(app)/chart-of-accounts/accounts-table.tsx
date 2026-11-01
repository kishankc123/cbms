"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AddAccountDialog } from "./add-account-dialog";
import { useProblem } from "@/components/problem-dialog";
import { AccountRowActions, Balance, SystemBadge, TYPE_LABEL } from "./shared";
import { ACCOUNT_SUB_CATEGORIES } from "@/lib/ledger/account-sub-categories";

type Account = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory: string | null;
  tdsHeadKey: string | null;
  isActive: boolean;
  /** Balance including every account beneath it. */
  total: number;
  system: boolean;
  contra?: boolean;
};

type SortField = "code" | "name" | "category" | "total";

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();

  useEffect(() => {
    if (!filtersOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [filtersOpen]);

  const filtered = useMemo(() => {
    return accounts
      .filter((a) => subCategoryFilter === "all" || a.subCategory === subCategoryFilter)
      .filter((a) => statusFilter === "all" || (statusFilter === "active" ? a.isActive : !a.isActive))
      .sort((a, b) => {
        const cmp = sortField === "total" ? a.total - b.total : a[sortField].localeCompare(b[sortField]);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [accounts, subCategoryFilter, statusFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (field === sortField) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <AddAccountDialog label="Add account" startInside={false} groups={accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name, category: a.category, tdsHeadKey: a.tdsHeadKey }))} />

        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-label="Filters"
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm ${
              subCategoryFilter !== "all" || statusFilter !== "all" ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-gray-300 text-gray-600 hover:text-gray-900"
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
              <path d="M1 2h14l-5.5 6.5V14l-3-1.5V8.5z" />
            </svg>
            Filter
          </button>

          {filtersOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-64 space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Filter by category</label>
                <select value={subCategoryFilter} onChange={(e) => setSubCategoryFilter(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="all">All categories</option>
                  {ACCOUNT_SUB_CATEGORIES.map((sc) => (
                    <option key={sc.label} value={sc.label}>
                      {sc.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Filter by status</label>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              {(subCategoryFilter !== "all" || statusFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSubCategoryFilter("all");
                    setStatusFilter("all");
                  }}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {dialog}

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <SortableHeader label="Code" field="code" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <SortableHeader label="Type" field="category" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <th className="px-4 py-2 font-medium">Category</th>
            <SortableHeader label="Balance" field="total" sortField={sortField} sortDir={sortDir} onSort={toggleSort} align="right" />
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.id} className={`border-t border-gray-100 ${a.isActive ? "" : "text-gray-400"}`}>
              <td className="px-4 py-2 font-mono">{a.code}</td>
              <td className="px-4 py-2">
                {a.name}
                {a.system && <SystemBadge />}
              </td>
              <td className="px-4 py-2">{TYPE_LABEL[a.category]}</td>
              <td className="px-4 py-2">{a.subCategory ?? "—"}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                <Balance value={a.total} contra={a.contra} />
              </td>
              <td className="px-4 py-2">{a.isActive ? "Active" : "Inactive"}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <AccountRowActions account={a} showSubCategory onError={(message) => report(message)} />
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No accounts match these filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-gray-400">A group&apos;s balance includes everything in its sub-groups.</p>
    </div>
  );
}

function SortableHeader({ label, field, sortField, sortDir, onSort, align }: { label: string; field: SortField; sortField: SortField; sortDir: "asc" | "desc"; onSort: (field: SortField) => void; align?: "right" }) {
  const active = field === sortField;
  return (
    <th className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={() => onSort(field)} className={`inline-flex items-center gap-1 hover:text-gray-900 ${active ? "text-gray-900" : ""}`}>
        {label}
        <span className="text-[10px] w-3 inline-block">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}
