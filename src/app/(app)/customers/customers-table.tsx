"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createCustomer, deleteCustomer, updateCustomer } from "./actions";
import { CustomerFormModal } from "./customer-form-modal";

type Customer = {
  id: string;
  name: string;
  phone: string;
  details: string;
  openingBalance: number;
  outstanding: number;
};

type SortField = "name" | "outstanding";

export function CustomersTable({ customers }: { customers: Customer[] }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q))
      .sort((a, b) => {
        const cmp = sortField === "name" ? a.name.localeCompare(b.name) : a.outstanding - b.outstanding;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [customers, search, sortField, sortDir]);

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
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-64"
        />
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

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">History</th>
            <th className="px-4 py-2 font-medium">Actions</th>
            <SortableHeader label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
            <th className="px-4 py-2 font-medium">Contact number</th>
            <th className="px-4 py-2 font-medium">Address</th>
            <SortableHeader
              label="Outstanding (AR)"
              field="outstanding"
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="px-4 py-2">
                <Link
                  href={`/customers/${c.id}/history`}
                  target="_blank"
                  className="text-[var(--color-primary)] hover:underline text-xs"
                >
                  History
                </Link>
              </td>
              <td className="px-4 py-2">
                <div className="flex gap-3">
                  <CustomerFormModal
                    title="Edit customer"
                    action={updateCustomer}
                    customerId={c.id}
                    initial={{
                      name: c.name,
                      phone: c.phone,
                      details: c.details,
                      openingBalance: c.openingBalance,
                    }}
                    trigger={(open) => (
                      <button type="button" onClick={open} className="text-xs text-gray-600 hover:text-gray-900">
                        Edit
                      </button>
                    )}
                  />
                  <form
                    action={deleteCustomer}
                    onSubmit={(e) => {
                      if (!confirm(`Delete ${c.name}? This cannot be undone.`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="customerId" value={c.id} />
                    <button type="submit" className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </form>
                </div>
              </td>
              <td className="px-4 py-2">{c.name}</td>
              <td className="px-4 py-2 text-gray-500">{c.phone || "—"}</td>
              <td className="px-4 py-2 text-gray-500">{c.details || "—"}</td>
              <td className="px-4 py-2">{c.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
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
