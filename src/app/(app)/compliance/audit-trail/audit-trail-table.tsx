"use client";

import { useState } from "react";
import { listAuditTrail } from "../actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { DT } from "@/components/calendar/date-text";
type Entry = Awaited<ReturnType<typeof listAuditTrail>>[number];

export function AuditTrailTable({ initialEntries }: { initialEntries: Entry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(false);

  async function applyFilters() {
    setLoading(true);
    try {
      const rows = await listAuditTrail({ from: from || undefined, to: to || undefined, entityType: entityType || undefined });
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <DatePicker value={from} onChange={(v) => setFrom(v)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <DatePicker value={to} onChange={(v) => setTo(v)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entity type</label>
          <input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. accounting_period" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <button type="button" disabled={loading} onClick={applyFilters} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
          {loading ? "Loading..." : "Filter"}
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Date/Time</th>
            <th className="px-4 py-2 font-medium">User</th>
            <th className="px-4 py-2 font-medium">Action</th>
            <th className="px-4 py-2 font-medium">Entity</th>
            <th className="px-4 py-2 font-medium">Before</th>
            <th className="px-4 py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-gray-100">
              <td className="px-4 py-2 whitespace-nowrap"><DT value={e.timestamp} /></td>
              <td className="px-4 py-2">{e.userName}</td>
              <td className="px-4 py-2">{e.action}</td>
              <td className="px-4 py-2">
                {e.entityType}
                {e.entityId ? ` (${e.entityId.slice(0, 8)})` : ""}
              </td>
              <td className="px-4 py-2 max-w-[200px] truncate text-xs text-gray-500">{e.beforeValue ? JSON.stringify(e.beforeValue) : "—"}</td>
              <td className="px-4 py-2 max-w-[200px] truncate text-xs text-gray-500">{e.afterValue ? JSON.stringify(e.afterValue) : "—"}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No audit entries recorded yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
