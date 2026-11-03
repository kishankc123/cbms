"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { voidInvoice } from "./actions";
import { EditSingleInvoiceModal } from "./edit-single-invoice-modal";
import { RowMenu } from "@/components/row-menu";
import { useProblem } from "@/components/problem-dialog";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { controlClass, Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Customer = { id: string; name: string };
type Item = { id: string; name: string; sellingPrice: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type Invoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  invoiceDate: string;
  dueDate?: string | null;
  total: string;
  amountPaid: string;
  status: string;
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
];

// How the invoice was paid: the mode of each payment received (Cash, Fonepay, ...). A void invoice says so; one with nothing
// received yet says Unpaid.
function paidBy(inv: Invoice, modes: string[] | undefined) {
  if (inv.status === "void") return "Void";
  return modes && modes.length > 0 ? modes.join(", ") : "Unpaid";
}

// What the list's status badge and the status filter say: paid, part paid, late or simply unpaid.
function stateOf(inv: Invoice, today: string): "void" | "paid" | "overdue" | "partially_paid" | "unpaid" {
  if (inv.status === "void") return "void";
  if (inv.status === "paid") return "paid";
  if (inv.status === "overdue" || (inv.dueDate && inv.dueDate < today)) return "overdue";
  return inv.status === "partially_paid" ? "partially_paid" : "unpaid";
}
const BADGE: Record<ReturnType<typeof stateOf>, { tone: StatusTone; label: string }> = {
  void: { tone: "neutral", label: "Void" },
  paid: { tone: "success", label: "Paid" },
  overdue: { tone: "critical", label: "Overdue" },
  partially_paid: { tone: "pending", label: "Partially paid" },
  unpaid: { tone: "action", label: "Unpaid" },
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

type SortKey = "date" | "invoiceNumber" | "customer" | "total" | "mode";
type SortDir = "asc" | "desc";

export function InvoicesTable({
  invoiceList,
  paymentModes,
  customerById,
  customers,
  items,
  cashBankAccounts,
  customerBalances,
  vatRate,
}: {
  invoiceList: Invoice[];
  paymentModes: Record<string, string[]>;
  customerById: Record<string, Customer>;
  customers: Customer[];
  items: Item[];
  cashBankAccounts: CashBankGroup[];
  customerBalances: Record<string, number>;
  vatRate: number;
}) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const today = useMemo(() => todayIso(), []);
  const filtering = Boolean(search || dateFrom || dateTo || customerFilter || statusFilter);

  async function voidRow(invoice: Invoice) {
    if (!(await ask(`Void invoice ${invoice.invoiceNumber}?`, { danger: true, confirmLabel: "Void" }))) return;
    const fd = new FormData();
    fd.set("invoiceId", invoice.id);
    try {
      await voidInvoice(fd);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not void the invoice", null);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }
  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setCustomerFilter("");
    setStatusFilter("");
  }

  const summary = useMemo(() => {
    const live = invoiceList.filter((i) => i.status !== "void");
    const owing = (i: Invoice) => Math.max(Number(i.total) - Number(i.amountPaid), 0);
    return {
      total: live.reduce((s, i) => s + Number(i.total), 0),
      received: live.reduce((s, i) => s + Number(i.amountPaid), 0),
      outstanding: live.reduce((s, i) => s + owing(i), 0),
      overdue: live.filter((i) => stateOf(i, today) === "overdue").reduce((s, i) => s + owing(i), 0),
    };
  }, [invoiceList, today]);

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = invoiceList.filter((inv) => {
      if (q && !(inv.invoiceNumber.toLowerCase().includes(q) || (customerById[inv.customerId]?.name ?? "").toLowerCase().includes(q) || inv.total.toLowerCase().includes(q))) return false;
      if (dateFrom && inv.invoiceDate < dateFrom) return false;
      if (dateTo && inv.invoiceDate > dateTo) return false;
      if (customerFilter && inv.customerId !== customerFilter) return false;
      if (statusFilter && stateOf(inv, today) !== statusFilter) return false;
      return true;
    });

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.invoiceDate;
            bv = b.invoiceDate;
            break;
          case "invoiceNumber":
            av = a.invoiceNumber;
            bv = b.invoiceNumber;
            break;
          case "total":
            av = Number(a.total);
            bv = Number(b.total);
            break;
          case "mode":
            av = paidBy(a, paymentModes[a.id]);
            bv = paidBy(b, paymentModes[b.id]);
            break;
          default:
            av = customerById[a.customerId]?.name ?? "";
            bv = customerById[b.customerId]?.name ?? "";
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [invoiceList, paymentModes, customerById, search, dateFrom, dateTo, customerFilter, statusFilter, today, sortKey, sortDir]);

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Total sales", value: fmt(summary.total) },
          { label: "Received", value: fmt(summary.received) },
          { label: "Outstanding", value: fmt(summary.outstanding), tone: summary.outstanding > 0.005 ? "warning" : "default" },
          { label: "Overdue", value: fmt(summary.overdue), tone: summary.overdue > 0.005 ? "danger" : "default" },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search customer, invoice # or amount" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-2">From</span>
          <DatePicker value={dateFrom} onChange={setDateFrom} className={`${controlClass} w-40`} />
          <span className="text-xs text-ink-2">To</span>
          <DatePicker value={dateTo} onChange={setDateTo} className={`${controlClass} w-40`} />
        </div>
        <Select aria-label="Customer" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="w-44">
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {filtering && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      <DataTable stickyHeader>
        <thead>
          <Tr className="hover:bg-transparent">
            <SortableTh direction={dirOf("date")} onSort={() => toggleSort("date")}>
              Date
            </SortableTh>
            <SortableTh direction={dirOf("invoiceNumber")} onSort={() => toggleSort("invoiceNumber")}>
              Invoice #
            </SortableTh>
            <SortableTh direction={dirOf("customer")} onSort={() => toggleSort("customer")}>
              Customer
            </SortableTh>
            <SortableTh align="right" direction={dirOf("total")} onSort={() => toggleSort("total")}>
              Amount
            </SortableTh>
            <SortableTh direction={dirOf("mode")} onSort={() => toggleSort("mode")}>
              Mode of payment
            </SortableTh>
            <Th>Status</Th>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {sorted.map((inv) => {
            const badge = BADGE[stateOf(inv, today)];
            const modes = paymentModes[inv.id];
            return (
              <Tr key={inv.id}>
                <Td className="whitespace-nowrap">
                  <D value={inv.invoiceDate} />
                </Td>
                <Td className="font-mono text-xs">{inv.invoiceNumber}</Td>
                <Td className="max-w-56 truncate">{customerById[inv.customerId]?.name ?? "—"}</Td>
                <Td numeric className="font-medium">
                  <Amount value={Number(inv.total)} />
                </Td>
                <Td className="text-ink-2">{inv.status !== "void" && modes?.length ? modes.join(", ") : "—"}</Td>
                <Td>
                  <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                </Td>
                <Td className="whitespace-nowrap">
                  <RowActions>
                    <RowMenu
                      items={[
                        { label: "Edit", onClick: () => setEditingId(inv.id), hidden: inv.status === "void" },
                        { label: "Void", onClick: () => voidRow(inv), danger: true, hidden: inv.status === "void" },
                      ]}
                    />
                  </RowActions>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </DataTable>
      {sorted.length === 0 &&
        (invoiceList.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices yet" description="Record a sale from the Add new tab and its invoice will be listed here." />
        ) : (
          <EmptyState icon={Receipt} title="No invoices match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}

      {editingId && <EditSingleInvoiceModal invoiceId={editingId} customers={customers} items={items} cashBankAccounts={cashBankAccounts} customerBalances={customerBalances} vatRate={vatRate} onClose={() => setEditingId(null)} />}
      {dialog}
    </div>
  );
}
