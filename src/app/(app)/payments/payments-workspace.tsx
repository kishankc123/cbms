"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { listPayments, getPaymentSummary, exportPaymentsCsv, getPaymentFormOptions, type PaymentListFilters } from "./actions";
import { PAYMENT_TYPE_LABELS, MONEY_IN_TYPE_OPTIONS, MONEY_OUT_TYPE_OPTIONS, STATUS_FILTER_OPTIONS } from "./payment-types";
import { NewPaymentModal } from "./new-payment-modal";
import { PaymentDetailDrawer } from "./payment-detail-drawer";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

type FormOptions = Awaited<ReturnType<typeof getPaymentFormOptions>>;
type PaymentRow = Awaited<ReturnType<typeof listPayments>>[number];
type Summary = Awaited<ReturnType<typeof getPaymentSummary>>;

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const DATE_PRESETS = [
  { value: "this_month", label: "This month" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "last_month", label: "Last month" },
  { value: "this_fiscal_year", label: "This fiscal year" },
  { value: "custom", label: "Custom date range" },
] as const;

function resolvePreset(preset: string): { from: string; to: string } {
  const now = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "today") return { from: toISO(now), to: toISO(now) };
  if (preset === "this_week") {
    const day = now.getUTCDay();
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
    return { from: toISO(monday), to: toISO(now) };
  }
  if (preset === "last_month") {
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 86400000);
    const lastMonthStart = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));
    return { from: toISO(lastMonthStart), to: toISO(lastMonthEnd) };
  }
  if (preset === "this_fiscal_year") {
    // Falls back to calendar year — actual fiscal year dates live in
    // Settings and aren't threaded through this lightweight preset.
    return { from: `${now.getUTCFullYear()}-01-01`, to: toISO(now) };
  }
  // this_month / default
  return { from: today().slice(0, 8) + "01", to: toISO(now) };
}

const ALLOCATION_TONE: Record<string, StatusTone> = {
  fully_allocated: "success",
  partially_allocated: "pending",
  unallocated: "action",
};
const RECON_TONE: Record<string, StatusTone> = { reconciled: "success", unreconciled: "pending" };
const STATUS_TONE: Record<string, StatusTone> = { posted: "success", draft: "pending", voided: "critical" };

export function PaymentsWorkspace({
  formOptions,
  initialPayments,
  initialSummary,
  initialFrom,
  initialTo,
  fixedDirection,
}: {
  formOptions: FormOptions;
  initialPayments: PaymentRow[];
  initialSummary: Summary;
  initialFrom: string;
  initialTo: string;
  fixedDirection?: "money_in" | "money_out";
}) {
  const router = useRouter();
  const [datePreset, setDatePreset] = useState("this_month");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [direction, setDirection] = useState<"all" | "money_in" | "money_out">(fixedDirection ?? "all");
  const [paymentType, setPaymentType] = useState("all");
  const [accountId, setAccountId] = useState("");
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier" | "employee" | "other">("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState<PaymentRow[]>(initialPayments);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const typeOptions = direction === "money_out" ? MONEY_OUT_TYPE_OPTIONS : direction === "money_in" ? MONEY_IN_TYPE_OPTIONS : [...MONEY_IN_TYPE_OPTIONS, ...MONEY_OUT_TYPE_OPTIONS];

  const flatAccounts = useMemo(() => {
    const list: { id: string; label: string }[] = [];
    for (const g of formOptions.cashBankAccounts) {
      if (g.children.length === 0) list.push({ id: g.id, label: `${g.code} — ${g.name}` });
      else for (const c of g.children) list.push({ id: c.id, label: `${c.code} — ${c.name}` });
    }
    return list;
  }, [formOptions.cashBankAccounts]);

  const filters: PaymentListFilters = useMemo(
    () => ({
      from,
      to,
      direction,
      paymentType: paymentType as PaymentListFilters["paymentType"],
      accountId: accountId || undefined,
      partyType,
      status: status as PaymentListFilters["status"],
      search,
    }),
    [from, to, direction, paymentType, accountId, partyType, status, search]
  );

  async function refresh() {
    setLoading(true);
    try {
      const [rowsResult, summaryResult] = await Promise.all([listPayments(filters), getPaymentSummary({ from, to, direction })]);
      setRows(rowsResult);
      setSummary(summaryResult);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (datePreset === "custom") return;
    const { from: f, to: t } = resolvePreset(datePreset);
    setFrom(f);
    setTo(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function handleClearFilters() {
    setDatePreset("this_month");
    setDirection(fixedDirection ?? "all");
    setPaymentType("all");
    setAccountId("");
    setPartyType("all");
    setStatus("all");
    setSearch("");
  }

  async function handleExport() {
    const csv = await exportPaymentsCsv(filters);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onSaved() {
    setShowNew(false);
    refresh();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button type="button" disabled className="rounded border border-gray-300 text-gray-400 text-sm px-4 py-1.5 cursor-not-allowed" title="Coming soon">
          Import
        </button>
        <button type="button" onClick={handleExport} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">
          Export
        </button>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-4 py-1.5"
        >
          + New Payment
        </button>
      </div>

      <div className={`grid grid-cols-2 gap-4 ${fixedDirection ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
        {fixedDirection !== "money_out" && <SummaryCard label="Total Received" value={summary.totalReceived} tone="success" />}
        {fixedDirection !== "money_in" && <SummaryCard label="Total Paid" value={summary.totalPaid} tone="critical" />}
        <SummaryCard label="Unallocated" value={summary.unallocated} tone="action" />
        <SummaryCard label="Reconciled" value={summary.reconciled} tone="pending" />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {DATE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {datePreset === "custom" && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            </>
          )}
          {!fixedDirection && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Direction</label>
              <select
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value as typeof direction);
                  setPaymentType("all");
                }}
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="all">All</option>
                <option value="money_in">Money In</option>
                <option value="money_out">Money Out</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
            <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="all">All types</option>
              {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All accounts</option>
              {flatAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Party</label>
            <select value={partyType} onChange={(e) => setPartyType(e.target.value as typeof partyType)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="all">All parties</option>
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
              <option value="employee">Employee</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {STATUS_FILTER_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={handleClearFilters} className="text-sm text-gray-500 hover:text-gray-700">
            Clear Filters
          </button>
        </div>

        <div className="mt-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payment no., party, reference, description, cheque no..."
            className="w-full max-w-md rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Payment No.</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Date</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Type</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Party</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Account</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Reference</th>
              <th className="px-3 py-2 font-semibold text-xs text-right whitespace-nowrap">Amount</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Allocation</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Reconciliation</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap">Status</th>
              <th className="px-3 py-2 font-semibold text-xs whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-sm text-gray-400">
                  {loading ? "Loading..." : "No payments match these filters."}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.paymentNumber}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.paymentDate}</td>
                <td className="px-3 py-2 whitespace-nowrap">{PAYMENT_TYPE_LABELS[r.paymentType] ?? r.paymentType}</td>
                <td className="px-3 py-2">{r.party}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.accountName}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.referenceNumber ?? r.chequeNumber ?? "—"}</td>
                <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${r.direction === "money_in" ? "text-green-700" : "text-red-700"}`}>
                  {r.direction === "money_in" ? "+" : "-"}
                  {fmt(r.amount)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.allocationStatus === "n/a" ? <span className="text-xs text-gray-400">—</span> : <StatusPill tone={ALLOCATION_TONE[r.allocationStatus] ?? "pending"}>{r.allocationStatus.replace("_", " ")}</StatusPill>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusPill tone={RECON_TONE[r.reconciliationStatus] ?? "pending"}>{r.reconciliationStatus}</StatusPill>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusPill tone={STATUS_TONE[r.status] ?? "pending"}>{r.status}</StatusPill>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button type="button" onClick={() => setDetailId(r.id)} className="text-xs text-[var(--color-primary)] hover:underline">
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && <NewPaymentModal formOptions={formOptions} onDone={onSaved} onCancel={() => setShowNew(false)} fixedDirection={fixedDirection} />}
      {detailId && (
        <PaymentDetailDrawer
          paymentId={detailId}
          onClose={() => setDetailId(null)}
          onVoided={() => {
            setDetailId(null);
            refresh();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "success" | "critical" | "action" | "pending" }) {
  const textTone = tone === "success" ? "text-green-700" : tone === "critical" ? "text-red-700" : tone === "action" ? "text-amber-700" : "text-blue-700";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${textTone}`}>{fmt(value)}</p>
    </div>
  );
}
