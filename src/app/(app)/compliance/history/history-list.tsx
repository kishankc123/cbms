"use client";

import { useMemo, useState } from "react";
import type { HistoryItem } from "@/lib/compliance/history-map";
import { DT } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { useFormatDate } from "@/components/calendar/calendar-provider";
import { todayIso } from "@/lib/calendar";

const sel = "rounded border border-gray-300 px-2 py-1.5 text-sm";
const CATEGORIES = ["Company", "Ownership", "Capital", "Share Lagat", "Tax registration", "Tax compliance", "Statutory"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function HistoryList({ items }: { items: HistoryItem[] }) {
  const fmtDate = useFormatDate();
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  // Stored dates are AD; show them in the organization's calendar like everywhere else.
  const show = (v: string | null) => (v === null ? "—" : ISO_DATE.test(v) ? fmtDate(v) : v);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      const day = todayIso(new Date(i.at)); // the (Nepal) calendar day it happened
      if (category !== "all" && i.category !== category) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!q) return true;
      return `${i.title} ${i.by} ${i.reason ?? ""} ${i.changes.map((c) => `${c.field} ${c.previous ?? ""} ${c.next ?? ""}`).join(" ")}`.toLowerCase().includes(q);
    });
  }, [items, category, from, to, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Change, person, reason…" className={`${sel} w-56`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Area</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>
            <option value="all">All areas</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <DatePicker value={from} onChange={setFrom} className={`${sel} w-32`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <DatePicker value={to} onChange={setTo} className={`${sel} w-32`} />
        </div>
      </div>

      <ul className="space-y-2">
        {rows.map((i) => (
          <li key={i.id} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{i.title}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  <DT value={i.at} /> · {i.by} · {i.category}
                </p>
              </div>
            </div>
            {i.changes.length > 0 && (
              <dl className="mt-2 space-y-1 text-sm">
                {i.changes.map((c, idx) => (
                  <div key={idx} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="w-44 shrink-0 text-xs text-gray-500">{c.field}</dt>
                    <dd className="text-gray-600">
                      <span className="text-gray-400">{show(c.previous)}</span>
                      <span className="mx-2 text-gray-300">→</span>
                      <span className="font-medium text-gray-900">{show(c.next)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {i.reason && <p className="mt-2 text-xs text-gray-500">Reason: {i.reason}</p>}
          </li>
        ))}
        {rows.length === 0 && <li className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">{items.length === 0 ? "No compliance changes recorded yet." : "Nothing matches these filters."}</li>}
      </ul>
    </div>
  );
}
