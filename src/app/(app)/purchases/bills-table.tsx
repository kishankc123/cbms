"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { voidBill } from "./actions";
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

type Vendor = { id: string; name: string };
type Bill = {
  id: string;
  billNumber: string;
  vendorId: string | null;
  description: string | null;
  billDate: string;
  dueDate?: string | null;
  total: string;
  amountPaid?: string;
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

// How the bill was paid: the mode of each payment made (Cash, Fonepay, ...). What is still owed is on Credit, so a bill with nothing
// paid says Credit and a part-paid one says, for example, "Cash, Credit". A void bill says so.
function paidBy(b: Bill, modes: string[] | undefined) {
  if (b.status === "void") return "Void";
  const owed = b.status !== "paid";
  const list = [...(modes ?? []), ...(owed ? ["Credit"] : [])];
  return list.length > 0 ? list.join(", ") : "Paid";
}

// A bill still owed past its due date is overdue. Derived, not stored, so it can't go stale.
function stateOf(b: Bill, today: string): "void" | "paid" | "overdue" | "partially_paid" | "unpaid" {
  if (b.status === "void") return "void";
  if (b.status === "paid") return "paid";
  if (b.status === "overdue" || (b.dueDate && b.dueDate < today)) return "overdue";
  return b.status === "partially_paid" ? "partially_paid" : "unpaid";
}
const BADGE: Record<ReturnType<typeof stateOf>, { tone: StatusTone; label: string }> = {
  void: { tone: "neutral", label: "Void" },
  paid: { tone: "success", label: "Paid" },
  overdue: { tone: "critical", label: "Overdue" },
  partially_paid: { tone: "pending", label: "Partially paid" },
  unpaid: { tone: "action", label: "Unpaid" },
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

type SortKey = "date" | "billNumber" | "supplier" | "total" | "mode";
type SortDir = "asc" | "desc";

export function BillsTable({
  vendors,
  bills,
  paymentModes,
  onEdit,
}: {
  vendors: Vendor[];
  bills: Bill[];
  /** The payment modes each bill was paid with, by bill id. */
  paymentModes: Record<string, string[]>;
  onEdit?: (billId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const router = useRouter();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const today = useMemo(() => todayIso(), []);
  const filtering = Boolean(search || dateFrom || dateTo || supplierFilter || statusFilter);

  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const nameOf = (b: Bill) => vendorById.get(b.vendorId ?? "")?.name ?? b.description ?? "";

  async function voidRow(b: Bill) {
    if (!(await ask(`Void bill ${b.billNumber}?`, { danger: true, confirmLabel: "Void" }))) return;
    const fd = new FormData();
    fd.set("billId", b.id);
    try {
      await voidBill(fd);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not void the bill", null);
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
    setSupplierFilter("");
    setStatusFilter("");
  }

  const summary = useMemo(() => {
    const live = bills.filter((b) => b.status !== "void");
    const owing = (b: Bill) => (b.status === "paid" ? 0 : Math.max(Number(b.total) - Number(b.amountPaid ?? 0), 0));
    return {
      total: live.reduce((s, b) => s + Number(b.total), 0),
      paid: live.reduce((s, b) => s + (b.status === "paid" ? Number(b.total) : Number(b.amountPaid ?? 0)), 0),
      outstanding: live.reduce((s, b) => s + owing(b), 0),
      overdue: live.filter((b) => stateOf(b, today) === "overdue").reduce((s, b) => s + owing(b), 0),
    };
  }, [bills, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = bills.filter((b) => {
      if (q && !(b.billNumber.toLowerCase().includes(q) || nameOf(b).toLowerCase().includes(q) || b.total.toLowerCase().includes(q))) return false;
      if (dateFrom && b.billDate < dateFrom) return false;
      if (dateTo && b.billDate > dateTo) return false;
      if (supplierFilter && b.vendorId !== supplierFilter) return false;
      if (statusFilter && stateOf(b, today) !== statusFilter) return false;
      return true;
    });

    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (sortKey) {
          case "date":
            av = a.billDate;
            bv = b.billDate;
            break;
          case "billNumber":
            av = a.billNumber;
            bv = b.billNumber;
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
            av = nameOf(a);
            bv = nameOf(b);
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, paymentModes, search, dateFrom, dateTo, supplierFilter, statusFilter, today, vendorById, sortKey, sortDir]);

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Total purchases", value: fmt(summary.total) },
          { label: "Paid", value: fmt(summary.paid) },
          { label: "Outstanding", value: fmt(summary.outstanding), tone: summary.outstanding > 0.005 ? "warning" : "default" },
          { label: "Overdue", value: fmt(summary.overdue), tone: summary.overdue > 0.005 ? "danger" : "default" },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search supplier, bill # or amount" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-2">From</span>
          <DatePicker value={dateFrom} onChange={setDateFrom} className={`${controlClass} w-40`} />
          <span className="text-xs text-ink-2">To</span>
          <DatePicker value={dateTo} onChange={setDateTo} className={`${controlClass} w-40`} />
        </div>
        <Select aria-label="Supplier" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="w-44">
          <option value="">All suppliers</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
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
            <SortableTh direction={dirOf("billNumber")} onSort={() => toggleSort("billNumber")}>
              Bill #
            </SortableTh>
            <SortableTh direction={dirOf("supplier")} onSort={() => toggleSort("supplier")}>
              Supplier / details
            </SortableTh>
            <SortableTh align="right" direction={dirOf("total")} onSort={() => toggleSort("total")}>
              Total
            </SortableTh>
            <SortableTh direction={dirOf("mode")} onSort={() => toggleSort("mode")}>
              Mode of payment
            </SortableTh>
            <Th>Status</Th>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {filtered.map((b) => {
            const badge = BADGE[stateOf(b, today)];
            return (
              <Tr key={b.id}>
                <Td className="whitespace-nowrap">
                  <D value={b.billDate} />
                </Td>
                <Td className="font-mono text-xs">{b.billNumber}</Td>
                <Td className="max-w-56 truncate">{nameOf(b) || "—"}</Td>
                <Td numeric className="font-medium">
                  <Amount value={Number(b.total)} />
                </Td>
                <Td className="text-ink-2">{b.status === "void" ? "—" : paidBy(b, paymentModes[b.id])}</Td>
                <Td>
                  <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                </Td>
                <Td className="whitespace-nowrap">
                  <RowActions>
                    <RowMenu
                      items={[
                        { label: "Edit", onClick: () => onEdit?.(b.id), hidden: b.status === "void" || !onEdit },
                        { label: "Void", onClick: () => voidRow(b), danger: true, hidden: b.status === "void" },
                      ]}
                    />
                  </RowActions>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </DataTable>
      {filtered.length === 0 &&
        (bills.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No bills yet" description="Record a purchase from the Add tab and its bill will be listed here." />
        ) : (
          <EmptyState icon={ShoppingCart} title="No bills match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}
      {dialog}
    </div>
  );
}
