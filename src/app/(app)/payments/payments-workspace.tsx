"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { listPayments, getPaymentSummary, exportPaymentsCsv, getPaymentFormOptions, type PaymentListFilters } from "./actions";
import { PAYMENT_TYPE_LABELS, MONEY_IN_TYPE_OPTIONS, MONEY_OUT_TYPE_OPTIONS, STATUS_FILTER_OPTIONS } from "./payment-types";
import { NewPaymentModal, type EditingPayment } from "./new-payment-modal";
import { PaymentDetailDrawer } from "./payment-detail-drawer";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Download, Plus, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { controlClass, Select } from "@/components/ui/field";
import { DataTable, RowActions, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

import { DatePicker } from "@/components/calendar/date-picker";
import { presetRange, todayIso, type CalendarSystem, type DateRange, type RangePreset } from "@/lib/calendar";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { D } from "@/components/calendar/date-text";
import { DateDisplayControl, useDateDisplay } from "@/components/calendar/report-dates";
type FormOptions = Awaited<ReturnType<typeof getPaymentFormOptions>>;
type PaymentRow = Awaited<ReturnType<typeof listPayments>>[number];
type Summary = Awaited<ReturnType<typeof getPaymentSummary>>;

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => todayIso();

const DATE_PRESETS = [
  { value: "this_month", label: "This month" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "last_month", label: "Last month" },
  { value: "this_fiscal_year", label: "This fiscal year" },
  { value: "custom", label: "Custom date range" },
] as const;

function resolvePreset(preset: string, calendar: CalendarSystem, fiscal: DateRange | null): { from: string; to: string } {
  return presetRange(preset as RangePreset, calendar, todayIso(), fiscal);
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
  fiscal = null,
  title,
  description,
}: {
  formOptions: FormOptions;
  initialPayments: PaymentRow[];
  initialSummary: Summary;
  initialFrom: string;
  initialTo: string;
  fixedDirection?: "money_in" | "money_out";
  /** The organization's configured fiscal year (real AD boundaries). */
  fiscal?: DateRange | null;
  title: string;
  description: string;
}) {
  const calendar = useCalendar();
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
  // The payment being edited (opened from its detail), shown in the same form as a new payment.
  const [editing, setEditing] = useState<EditingPayment | null>(null);

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
    const { from: f, to: t } = resolvePreset(datePreset, calendar, fiscal);
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

  const [exportDates, setExportDates] = useDateDisplay();

  async function handleExport() {
    const csv = await exportPaymentsCsv(filters, exportDates);
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

  const filtering = datePreset !== "this_month" || (!fixedDirection && direction !== "all") || paymentType !== "all" || accountId !== "" || partyType !== "all" || status !== "all" || search !== "";

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        className="!mb-0"
        actions={
          <>
            <DateDisplayControl label="Export dates" value={exportDates} onChange={setExportDates} />
            <Button icon={<Download size={14} />} onClick={handleExport}>
              Export
            </Button>
          </>
        }
        primary={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
            New payment
          </Button>
        }
      />

      <StatStrip
        items={[
          ...(fixedDirection !== "money_out" ? [{ label: "Total received", value: fmt(summary.totalReceived) }] : []),
          ...(fixedDirection !== "money_in" ? [{ label: "Total paid", value: fmt(summary.totalPaid) }] : []),
          { label: "Unallocated", value: fmt(summary.unallocated), tone: summary.unallocated > 0.005 ? ("warning" as const) : ("default" as const) },
          { label: "Reconciled", value: fmt(summary.reconciled) },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search payment no., party, reference" className="max-w-72" />
        <Select aria-label="Date" value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className="w-40">
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        {datePreset === "custom" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-2">From</span>
            <DatePicker value={from} onChange={(v) => setFrom(v)} className={`${controlClass} w-40`} />
            <span className="text-xs text-ink-2">To</span>
            <DatePicker value={to} onChange={(v) => setTo(v)} className={`${controlClass} w-40`} />
          </div>
        )}
        {!fixedDirection && (
          <Select
            aria-label="Direction"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as typeof direction);
              setPaymentType("all");
            }}
            className="w-32"
          >
            <option value="all">In and out</option>
            <option value="money_in">Money in</option>
            <option value="money_out">Money out</option>
          </Select>
        )}
        <Select aria-label="Payment type" value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className="w-40">
          <option value="all">All types</option>
          {typeOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-44">
          <option value="">All accounts</option>
          {flatAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Party" value={partyType} onChange={(e) => setPartyType(e.target.value as typeof partyType)} className="w-32">
          <option value="all">All parties</option>
          <option value="customer">Customer</option>
          <option value="supplier">Supplier</option>
          <option value="employee">Employee</option>
          <option value="other">Other</option>
        </Select>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          {STATUS_FILTER_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {loading && rows.length === 0 ? (
        <TableSkeleton rows={6} cols={8} />
      ) : (
        <DataTable stickyHeader>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>Payment no.</Th>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Party</Th>
              <Th>Account</Th>
              <Th>Reference</Th>
              <Th align="right">Amount</Th>
              <Th>Allocation</Th>
              <Th>Reconciliation</Th>
              <Th>Status</Th>
              <Th className="w-10" />
            </Tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} clickable selected={detailId === r.id} onClick={() => setDetailId(r.id)}>
                <Td className="whitespace-nowrap font-mono text-xs">{r.paymentNumber}</Td>
                <Td className="whitespace-nowrap">
                  <D value={r.paymentDate} />
                </Td>
                <Td className="whitespace-nowrap">{PAYMENT_TYPE_LABELS[r.paymentType] ?? r.paymentType}</Td>
                <Td className="max-w-48 truncate">{r.party}</Td>
                <Td className="whitespace-nowrap text-ink-2">{r.accountName}</Td>
                <Td className="whitespace-nowrap text-ink-2">{r.referenceNumber ?? r.chequeNumber ?? "—"}</Td>
                <Td numeric className={`font-medium ${r.direction === "money_in" ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
                  {r.direction === "money_in" ? "+" : "-"}
                  {fmt(r.amount)}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.allocationStatus === "n/a" ? <span className="text-ink-2">—</span> : <StatusPill tone={ALLOCATION_TONE[r.allocationStatus] ?? "pending"}>{r.allocationStatus.replace("_", " ")}</StatusPill>}
                </Td>
                <Td className="whitespace-nowrap">
                  <StatusPill tone={RECON_TONE[r.reconciliationStatus] ?? "pending"}>{r.reconciliationStatus}</StatusPill>
                </Td>
                <Td className="whitespace-nowrap">
                  <StatusPill tone={STATUS_TONE[r.status] ?? "pending"}>{r.status}</StatusPill>
                </Td>
                <Td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <RowActions>
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(r.id)}>
                      View
                    </Button>
                  </RowActions>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {!loading && rows.length === 0 && (
        <EmptyState
          icon={Wallet}
          title={filtering ? "No payments match" : "No payments in this period"}
          description={filtering ? "Try different filters, or clear them." : "Payments recorded in this period will be listed here."}
          action={filtering ? <Button onClick={handleClearFilters}>Clear filters</Button> : undefined}
        />
      )}

      {showNew && <NewPaymentModal formOptions={formOptions} onDone={onSaved} onCancel={() => setShowNew(false)} fixedDirection={fixedDirection} />}
      {editing && (
        <NewPaymentModal
          formOptions={formOptions}
          editing={editing}
          onDone={() => {
            setEditing(null);
            onSaved();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {detailId && (
        <PaymentDetailDrawer
          paymentId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(d) => {
            setDetailId(null);
            setEditing(d);
          }}
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
