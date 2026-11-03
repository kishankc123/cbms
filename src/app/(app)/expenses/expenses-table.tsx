"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, Receipt } from "lucide-react";
import { voidExpense, getExpenseForEdit, type ExpenseEditData } from "./actions";
import { ExpenseFormModal, type InitialExpense } from "./expense-form-modal";
import { RecordExpensePaymentModal } from "./record-expense-payment-modal";
import { RowMenu } from "@/components/row-menu";
import { useProblem } from "@/components/problem-dialog";
import { escapeHtml, printDocument } from "@/lib/print-html";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { DateDisplayControl, useDateDisplay } from "@/components/calendar/report-dates";
import { exportDateColumns, exportDateHeaders, formatDate, todayIso, type DateDisplayMode } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { controlClass, Select } from "@/components/ui/field";
import { Amount, DataTable, RowActions, SortableTh, Td, Th, Tr } from "@/components/ui/data-table";
import { FilterBar, SearchInput } from "@/components/ui/filters";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Vendor = { id: string; name: string };
type CategoryAccount = { id: string; code: string; name: string; tdsHeadKey?: string | null };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

type ExpenseRow = {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  payee: string;
  vendorId: string | null;
  category: string;
  categoryAccountId: string;
  description: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPayable: number;
  amountPaid: number;
  status: string;
  dueDate: string | null;
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

// How the expense was paid: the mode of each payment (Cash, Fonepay, ...). A void expense says so; one with nothing paid yet says Unpaid.
function paidBy(e: ExpenseRow, modes: string[] | undefined) {
  if (e.status === "void") return "Void";
  return modes && modes.length > 0 ? modes.join(", ") : "Unpaid";
}

// The status badge: what is owed and whether it is late.
function badgeOf(e: ExpenseRow, today: string): { tone: StatusTone; label: string } {
  if (e.status === "void") return { tone: "neutral", label: "Void" };
  if (e.status === "paid") return { tone: "success", label: "Paid" };
  if (e.dueDate && e.dueDate < today) return { tone: "critical", label: "Overdue" };
  return e.status === "partially_paid" ? { tone: "pending", label: "Partially paid" } : { tone: "action", label: "Unpaid" };
}

type SortKey = "number" | "date" | "category" | "net" | "total";
type SortDir = "asc" | "desc";

export function ExpensesTable({
  paymentModes,
  expenses,
  vendors,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  newOpen,
  onNew,
  onNewClose,
}: {
  expenses: ExpenseRow[];
  vendors: Vendor[];
  paymentModes: Record<string, string[]>;
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  /** The "New expense" form is opened from the page header (or the empty list). */
  newOpen: boolean;
  onNew: () => void;
  onNewClose: () => void;
}) {
  const [exportDates, setExportDates] = useDateDisplay();
  const [editData, setEditData] = useState<InitialExpense | null>(null);
  const router = useRouter();
  const calendar = useCalendar();
  const ask = useConfirm();
  const { report, dialog } = useProblem();
  const [payingRow, setPayingRow] = useState<ExpenseRow | null>(null);
  const [viewingRow, setViewingRow] = useState<ExpenseRow | null>(null);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // Sorted by expense number to begin with; a click on a heading sorts by it, a second click reverses.
  const [sortKey, setSortKey] = useState<SortKey>("number");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const today = useMemo(() => todayIso(), []);
  const filtering = Boolean(search || dateFrom || dateTo || categoryFilter || statusFilter);

  const summary = useMemo(() => {
    const active = expenses.filter((e) => e.status !== "void");
    const total = active.reduce((s, e) => s + e.total, 0);
    const paid = active.filter((e) => e.status === "paid").reduce((s, e) => s + e.total, 0);
    const outstanding = active.filter((e) => e.status !== "paid");
    const unpaid = outstanding.reduce((s, e) => s + (e.amountPayable - e.amountPaid), 0);
    const overdue = outstanding
      .filter((e) => e.dueDate && e.dueDate < today)
      .reduce((s, e) => s + (e.amountPayable - e.amountPaid), 0);
    return { total, paid, unpaid, overdue };
  }, [expenses, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (q && !e.payee.toLowerCase().includes(q) && !e.expenseNumber.toLowerCase().includes(q)) return false;
      if (dateFrom && e.expenseDate < dateFrom) return false;
      if (dateTo && e.expenseDate > dateTo) return false;
      if (categoryFilter && e.categoryAccountId !== categoryFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      return true;
    });
  }, [expenses, search, dateFrom, dateTo, categoryFilter, statusFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "date":
          cmp = a.expenseDate < b.expenseDate ? -1 : a.expenseDate > b.expenseDate ? 1 : 0;
          break;
        case "category":
          cmp = a.category.localeCompare(b.category, undefined, { numeric: true });
          break;
        case "net":
          cmp = a.subtotal - b.subtotal;
          break;
        case "total":
          cmp = a.total - b.total;
          break;
        default:
          cmp = a.expenseNumber.localeCompare(b.expenseNumber, undefined, { numeric: true });
      }
      // Equal values fall back to the expense number, so the order never jumps about.
      return (cmp || a.expenseNumber.localeCompare(b.expenseNumber, undefined, { numeric: true })) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }
  const dirOf = (key: SortKey) => (sortKey === key ? sortDir : null);

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setCategoryFilter("");
    setStatusFilter("");
  }

  async function openEdit(id: string) {
    try {
      const data = await getExpenseForEdit(id);
      setEditData(toInitial(data));
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not open the expense for editing", null);
    }
  }

  async function voidRow(row: ExpenseRow) {
    if (!(await ask(`Void expense ${row.expenseNumber}? Its accounting entries will be reversed.`, { danger: true, confirmLabel: "Void" }))) return;
    const fd = new FormData();
    fd.set("expenseId", row.id);
    try {
      await voidExpense(fd);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not void the expense", null);
    }
  }

  // Prints this one expense (not the page behind it).
  function printExpense(e: ExpenseRow) {
    const row = (label: string, value: string) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
    const amount = (label: string, value: number, cls = "") => `<tr class="${cls}"><th>${escapeHtml(label)}</th><td class="num">${escapeHtml(fmt(value))}</td></tr>`;
    printDocument(
      `Expense ${e.expenseNumber}`,
      `<h1>Expense ${escapeHtml(e.expenseNumber)}</h1><div class="sub">${escapeHtml(formatDate(e.expenseDate, calendar))}</div>
       <table>${row("Supplier", e.payee)}${row("Category", e.category)}${row("Description", e.description || "—")}${row("Status", e.status.replace("_", " "))}</table>
       <table>${amount("Net amount", e.subtotal)}${amount("Tax", e.tax)}${amount("Total", e.total, "total")}${amount("Amount paid", e.amountPaid)}${amount("Still to pay", Math.max(e.amountPayable - e.amountPaid, 0))}</table>`
    );
  }

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Total expenses", value: fmt(summary.total) },
          { label: "Unpaid", value: fmt(summary.unpaid), tone: summary.unpaid > 0.005 ? "warning" : "default" },
          { label: "Paid", value: fmt(summary.paid) },
          { label: "Overdue", value: fmt(summary.overdue), tone: summary.overdue > 0.005 ? "danger" : "default" },
        ]}
      />

      <FilterBar className="!mb-0">
        <SearchInput value={search} onChange={setSearch} placeholder="Search supplier or expense #" />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-2">From</span>
          <DatePicker value={dateFrom} onChange={setDateFrom} className={`${controlClass} w-40`} />
          <span className="text-xs text-ink-2">To</span>
          <DatePicker value={dateTo} onChange={setDateTo} className={`${controlClass} w-40`} />
        </div>
        <Select aria-label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-44">
          <option value="">All categories</option>
          {categoryAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
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
        <div className="ml-auto flex items-center gap-2">
          <DateDisplayControl label="Export dates" value={exportDates} onChange={setExportDates} />
          <Button icon={<Download size={14} />} onClick={() => exportCsv(sorted, exportDates, paymentModes)}>
            Export
          </Button>
        </div>
      </FilterBar>

      <DataTable stickyHeader>
        <thead>
          <Tr className="hover:bg-transparent">
            <SortableTh direction={dirOf("number")} onSort={() => toggleSort("number")}>
              Expense #
            </SortableTh>
            <SortableTh direction={dirOf("date")} onSort={() => toggleSort("date")}>
              Date
            </SortableTh>
            <Th>Supplier</Th>
            <SortableTh direction={dirOf("category")} onSort={() => toggleSort("category")}>
              Category
            </SortableTh>
            <Th>Description</Th>
            <SortableTh align="right" direction={dirOf("net")} onSort={() => toggleSort("net")}>
              Net amount
            </SortableTh>
            <Th align="right">Tax</Th>
            <SortableTh align="right" direction={dirOf("total")} onSort={() => toggleSort("total")}>
              Total
            </SortableTh>
            <Th>Mode of payment</Th>
            <Th>Status</Th>
            <Th className="w-10" />
          </Tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const badge = badgeOf(e, today);
            const modes = paymentModes[e.id];
            return (
              <Tr key={e.id} clickable selected={viewingRow?.id === e.id} onClick={() => setViewingRow(e)}>
                <Td className="font-mono text-xs">{e.expenseNumber}</Td>
                <Td className="whitespace-nowrap">
                  <D value={e.expenseDate} />
                </Td>
                <Td className="max-w-48 truncate whitespace-nowrap">{e.payee}</Td>
                <Td className="max-w-56 truncate text-ink-2">{e.category}</Td>
                <Td className="max-w-48 truncate text-ink-2">{e.description || "—"}</Td>
                <Td numeric>
                  <Amount value={e.subtotal} />
                </Td>
                <Td numeric>
                  <Amount value={e.tax} />
                </Td>
                <Td numeric className="font-medium">
                  <Amount value={e.total} />
                </Td>
                <Td className="text-ink-2">{e.status !== "void" && modes?.length ? modes.join(", ") : "—"}</Td>
                <Td>
                  <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                </Td>
                <Td className="whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                  <RowActions>
                    <RowMenu
                      items={[
                        { label: "View", onClick: () => setViewingRow(e) },
                        { label: "Edit", onClick: () => openEdit(e.id), hidden: e.status === "void" },
                        { label: "Record payment", onClick: () => setPayingRow(e), hidden: !(e.status === "unpaid" || e.status === "partially_paid") },
                        { label: "Print", onClick: () => printExpense(e) },
                        { label: "Void", onClick: () => voidRow(e), danger: true, hidden: e.status === "void" },
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
        (expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses yet" description="Record what the business spends and it will be listed here." action={<Button variant="primary" icon={<Plus size={14} />} onClick={onNew}>New expense</Button>} />
        ) : (
          <EmptyState icon={Receipt} title="No expenses match" description="Try a different search, or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
        ))}

      {newOpen && <ExpenseFormModal vendors={vendors} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} vatRate={vatRate} onClose={onNewClose} />}

      {editData && <ExpenseFormModal vendors={vendors} categoryAccounts={categoryAccounts} cashBankAccounts={cashBankAccounts} vatRate={vatRate} initial={editData} onClose={() => setEditData(null)} />}

      {payingRow && <RecordExpensePaymentModal expenseId={payingRow.id} expenseNumber={payingRow.expenseNumber} remaining={payingRow.amountPayable - payingRow.amountPaid} cashBankAccounts={cashBankAccounts} onClose={() => setPayingRow(null)} />}

      {viewingRow && (
        <Modal
          size="sm"
          title={viewingRow.expenseNumber}
          onClose={() => setViewingRow(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => printExpense(viewingRow)}>
                Print
              </Button>
              <Button variant="primary" onClick={() => setViewingRow(null)}>
                Close
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <Item label="Date">
              <D value={viewingRow.expenseDate} />
            </Item>
            <Item label="Supplier">{viewingRow.payee}</Item>
            <Item label="Category">{viewingRow.category}</Item>
            <Item label="Status">
              <StatusPill tone={badgeOf(viewingRow, today).tone}>{badgeOf(viewingRow, today).label}</StatusPill>
            </Item>
            <Item label="Description" wide>
              {viewingRow.description || "—"}
            </Item>
            <Item label="Net amount">
              <Amount value={viewingRow.subtotal} />
            </Item>
            <Item label="Tax">
              <Amount value={viewingRow.tax} />
            </Item>
            <Item label="Total">
              <Amount value={viewingRow.total} className="font-semibold" />
            </Item>
            <Item label="Amount paid">
              <Amount value={viewingRow.amountPaid} />
            </Item>
          </dl>
        </Modal>
      )}
      {dialog}
    </div>
  );
}

function Item({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function toInitial(data: ExpenseEditData): InitialExpense {
  return { ...data };
}

function exportCsv(rows: ExpenseRow[], dateMode: DateDisplayMode, paymentModes: Record<string, string[]>) {
  const header = ["Expense #", ...exportDateHeaders(dateMode), "Supplier", "Category", "Description", "Net amount", "Tax", "Total", "Mode of payment", "Status"];
  const lines = rows.map((e) =>
    [e.expenseNumber, ...exportDateColumns(dateMode, e.expenseDate), e.payee, e.category, e.description, e.subtotal, e.tax, e.total, paidBy(e, paymentModes[e.id]), e.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "expenses.csv";
  a.click();
  URL.revokeObjectURL(url);
}
