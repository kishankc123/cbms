"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listInterTransfers, type TransferListFilters } from "./actions";
import { StatusPill } from "@/components/ui/status-pill";

import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
type Row = Awaited<ReturnType<typeof listInterTransfers>>[number];
type Option = { id: string; label: string; kind: "Cash" | "Bank" };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const selCls = "rounded border border-gray-300 px-2 py-1.5 text-sm";

export function TransfersTable({ initialRows, options }: { initialRows: Row[]; options: Option[] }) {
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const filters: TransferListFilters = {
      search,
      from: from || undefined,
      to: to || undefined,
      fromAccountId: fromAccountId || undefined,
      toAccountId: toAccountId || undefined,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
    };
    setLoading(true);
    listInterTransfers(filters).then(setRows).finally(() => setLoading(false));
  }, [search, from, to, fromAccountId, toAccountId, minAmount, maxAmount]);

  function clear() {
    setSearch(""); setFrom(""); setTo(""); setFromAccountId(""); setToAccountId(""); setMinAmount(""); setMaxAmount("");
  }

  const accountOptions = options.map((o) => (
    <option key={o.id} value={o.id}>{o.label}</option>
  ));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From date</label>
            <DatePicker value={from} onChange={(v) => setFrom(v)} className={selCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To date</label>
            <DatePicker value={to} onChange={(v) => setTo(v)} className={selCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">From Account</label>
            <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)} className={selCls}>
              <option value="">All</option>
              {accountOptions}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To Account</label>
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={selCls}>
              <option value="">All</option>
              {accountOptions}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min amount</label>
            <input type="number" min="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className={`${selCls} w-28`} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max amount</label>
            <input type="number" min="0" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className={`${selCls} w-28`} />
          </div>
          <button type="button" onClick={clear} className="text-sm text-gray-500 hover:text-gray-700">Clear Filters</button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transfer no. or reference..."
          className="w-full max-w-md rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold text-xs">Transfer No.</th>
              <th className="px-3 py-2 font-semibold text-xs">Date</th>
              <th className="px-3 py-2 font-semibold text-xs">From Account</th>
              <th className="px-3 py-2 font-semibold text-xs">To Account</th>
              <th className="px-3 py-2 font-semibold text-xs text-right">Amount</th>
              <th className="px-3 py-2 font-semibold text-xs">Reference</th>
              <th className="px-3 py-2 font-semibold text-xs">Status</th>
              <th className="px-3 py-2 font-semibold text-xs"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">{loading ? "Loading..." : "No transfers found."}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.transferNumber}</td>
                <td className="px-3 py-2 whitespace-nowrap"><D value={r.transferDate} /></td>
                <td className="px-3 py-2">{r.fromAccount}</td>
                <td className="px-3 py-2">{r.toAccount}</td>
                <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{fmt(r.amount)}</td>
                <td className="px-3 py-2 text-gray-500">{r.reference ?? "—"}</td>
                <td className="px-3 py-2"><StatusPill tone={r.status === "posted" ? "success" : "critical"}>{r.status}</StatusPill></td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/payments/inter-transfer/${r.id}`} className="text-xs text-[var(--color-primary)] hover:underline">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
