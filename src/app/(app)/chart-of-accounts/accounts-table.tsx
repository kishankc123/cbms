"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccount } from "./actions";
import { AccountEditModal } from "./account-edit-modal";
import { Balance, DeleteAccountButton, SystemBadge, TYPE_LABEL } from "./shared";
import { ACCOUNT_SUB_CATEGORIES } from "@/lib/ledger/account-sub-categories";

type Account = {
  id: string;
  code: string;
  name: string;
  category: "asset" | "liability" | "equity" | "income" | "expense";
  subCategory: string | null;
  isActive: boolean;
  /** Balance including every account beneath it. */
  total: number;
  system: boolean;
};

type SortField = "code" | "name" | "category" | "total";

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [subCategory, setSubCategory] = useState<string>(ACCOUNT_SUB_CATEGORIES[0].label);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await createAccount({ code, name, subCategory });
      if (!r.ok) return setError(r.error);
      setCode("");
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} required className="rounded border border-gray-300 px-2 py-1.5 text-sm w-24" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="rounded border border-gray-300 px-2 py-1.5 text-sm w-56" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[180px]">
              {ACCOUNT_SUB_CATEGORIES.map((sc) => (
                <option key={sc.label} value={sc.label}>
                  {sc.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
            Add account
          </button>
        </form>

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

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
                <Balance value={a.total} />
              </td>
              <td className="px-4 py-2">{a.isActive ? "Active" : "Inactive"}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-3">
                  <AccountEditModal
                    initial={{ id: a.id, name: a.name, isActive: a.isActive, category: a.category, subCategory: a.subCategory, system: a.system }}
                    showSubCategory
                    trigger={(open) => (
                      <button type="button" onClick={open} className="text-xs text-[var(--color-primary)] hover:underline">
                        Edit
                      </button>
                    )}
                  />
                  {!a.system && <DeleteAccountButton id={a.id} name={a.name} onError={setError} />}
                </div>
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
