"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { voidInvoice, getInvoiceAdvance, applyInvoiceAdvance, removeInvoiceAdvance } from "./actions";
import { ApplyAdvanceModal } from "@/components/apply-advance-modal";
import { EditSingleInvoiceModal } from "./edit-single-invoice-modal";
import { RowMenu } from "@/components/row-menu";
import { ConfirmDialog } from "./confirm-dialog";
import { useProblem } from "@/components/problem-dialog";

import { D } from "@/components/calendar/date-text";
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
  status: string;
};

// How the invoice was paid: the mode of each payment received (Cash, Fonepay, ...). A void invoice says so; one with nothing
// received yet says Unpaid.
function paidBy(inv: Invoice, modes: string[] | undefined) {
  if (inv.status === "void") return "Void";
  return modes && modes.length > 0 ? modes.join(", ") : "Unpaid";
}

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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [advanceId, setAdvanceId] = useState<string | null>(null);
  const [voidingInvoice, setVoidingInvoice] = useState<Invoice | null>(null);
  const router = useRouter();
  const { report, dialog } = useProblem();

  async function confirmVoid() {
    const invoice = voidingInvoice;
    setVoidingInvoice(null);
    if (!invoice) return;
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

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = !q
      ? invoiceList
      : invoiceList.filter(
          (inv) =>
            inv.invoiceNumber.toLowerCase().includes(q) ||
            (customerById[inv.customerId]?.name ?? "").toLowerCase().includes(q) ||
            inv.total.toLowerCase().includes(q)
        );

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
  }, [invoiceList, paymentModes, customerById, search, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer, invoice #, amount..."
          className="rounded border border-gray-300 px-3 py-1.5 text-sm w-72"
        />
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("date")}
            >
              Date{sortIndicator("date")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("invoiceNumber")}
            >
              Invoice #{sortIndicator("invoiceNumber")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("customer")}
            >
              Customer{sortIndicator("customer")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("total")}
            >
              Amount{sortIndicator("total")}
            </th>
            <th
              className="px-4 py-2 font-medium cursor-pointer select-none hover:text-gray-700"
              onClick={() => toggleSort("mode")}
            >
              Mode of payment{sortIndicator("mode")}
            </th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv) => (
            <tr key={inv.id} className="border-t border-gray-100">
              <td className="px-4 py-2"><D value={inv.invoiceDate} /></td>
              <td className="px-4 py-2 font-mono">{inv.invoiceNumber}</td>
              <td className="px-4 py-2">{customerById[inv.customerId]?.name ?? "—"}</td>
              <td className="px-4 py-2">
                {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className={`px-4 py-2 ${inv.status === "void" ? "text-gray-400" : paymentModes[inv.id]?.length ? "" : "text-gray-500"}`}>{paidBy(inv, paymentModes[inv.id])}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <RowMenu
                  items={[
                    {
                      label: "Apply advance",
                      onClick: () => setAdvanceId(inv.id),
                      hidden: !(inv.status === "sent" || inv.status === "partially_paid" || inv.status === "overdue"),
                    },
                    { label: "Edit", onClick: () => setEditingId(inv.id), hidden: inv.status === "void" },
                    { label: "Void", onClick: () => setVoidingInvoice(inv), danger: true, hidden: inv.status === "void" },
                  ]}
                />
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                No invoices yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editingId && (
        <EditSingleInvoiceModal
          invoiceId={editingId}
          customers={customers}
          items={items}
          cashBankAccounts={cashBankAccounts}
          customerBalances={customerBalances}
          vatRate={vatRate}
          onClose={() => setEditingId(null)}
        />
      )}
      {advanceId && (
        <ApplyAdvanceModal
          title="Apply customer advance"
          documentWord="invoice"
          partyWord="customer"
          load={() => getInvoiceAdvance(advanceId)}
          onApply={(amount) => applyInvoiceAdvance(advanceId, amount)}
          onRemove={(id) => removeInvoiceAdvance(id)}
          onClose={() => setAdvanceId(null)}
        />
      )}
      {voidingInvoice && (
        <ConfirmDialog
          message={`Void invoice ${voidingInvoice.invoiceNumber}?`}
          onYes={confirmVoid}
          onNo={() => setVoidingInvoice(null)}
        />
      )}
      {dialog}
    </>
  );
}
