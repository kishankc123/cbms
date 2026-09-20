"use client";

import { useMemo, useState } from "react";
import type { listTaxCompliance } from "../tax-actions";
import { ObligationStatusPill } from "@/components/compliance/status-pill";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { TaxObligationDrawer } from "./tax-obligation-drawer";

type Data = Awaited<ReturnType<typeof listTaxCompliance>>;

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const sel = "rounded border border-gray-300 px-2 py-1.5 text-sm";
const STATUS_FILTERS = [
  { key: "all", label: "All statuses" },
  { key: "open", label: "Open (not completed)" },
  { key: "overdue", label: "Overdue" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In progress" },
  { key: "filed", label: "Filed" },
  { key: "partially_paid", label: "Partially paid" },
  { key: "paid", label: "Paid" },
  { key: "not_applicable", label: "Not applicable" },
];

export function TaxComplianceTable({ data }: { data: Data }) {
  const [taxType, setTaxType] = useState("all");
  const [status, setStatus] = useState("open");
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const periods = useMemo(() => [...new Set(data.items.map((i) => i.period))], [data.items]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.items.filter((i) => {
      if (taxType !== "all" && i.taxTypeKey !== taxType) return false;
      if (period !== "all" && i.period !== period) return false;
      if (from && i.dueDate < from) return false;
      if (to && i.dueDate > to) return false;
      if (status === "open" && ["filed", "paid", "not_applicable"].includes(i.effective)) return false;
      if (status !== "all" && status !== "open" && i.effective !== status) return false;
      if (q && !`${i.name} ${i.period} ${i.taxTypeName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.items, taxType, period, from, to, status, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Return, period, tax…" className={`${sel} w-52`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tax type</label>
          <select value={taxType} onChange={(e) => setTaxType(e.target.value)} className={sel}>
            <option value="all">All taxes</option>
            {data.taxTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={sel}>
            <option value="all">All periods</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Due from</label>
          <DatePicker value={from} onChange={setFrom} className={`${sel} w-32`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Due to</label>
          <DatePicker value={to} onChange={setTo} className={`${sel} w-32`} />
        </div>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Compliance</th>
            <th className="px-4 py-2 font-medium">Period</th>
            <th className="px-4 py-2 font-medium">Due date</th>
            <th className="px-4 py-2 font-medium text-right">Amount due</th>
            <th className="px-4 py-2 font-medium text-right">Balance</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpenId(i.id)}>
              <td className="px-4 py-2">
                <span className="font-medium text-gray-900">{i.name}</span>
                {i.taxTypeName && <span className="ml-2 text-xs text-gray-400">{i.taxTypeName}</span>}
              </td>
              <td className="px-4 py-2">{i.period}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                <D value={i.dueDate} />
              </td>
              <td className="px-4 py-2 text-right">{i.amountDue > 0 ? fmt(i.amountDue) : "—"}</td>
              <td className="px-4 py-2 text-right">{i.amountDue > 0 ? fmt(i.balance) : "—"}</td>
              <td className="px-4 py-2">
                <ObligationStatusPill status={i.effective} />
              </td>
              <td className="px-4 py-2 text-right">
                <button type="button" className="text-xs text-[var(--color-primary)] hover:underline">
                  View
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                {data.items.length === 0 ? "No tax compliance items yet. They appear once you register for a tax (Tax Registrations) and set your company type." : "Nothing matches these filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {openId && <TaxObligationDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
