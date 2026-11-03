"use client";

import { Fragment, useState } from "react";
import { useErrorDialog } from "@/components/problem-dialog";
import { generateReport } from "../actions";
import type { ComplianceReportType } from "@/lib/compliance/reports";

import { DatePicker } from "@/components/calendar/date-picker";
import { presetRange } from "@/lib/calendar";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { DateCells, DateDisplayControl, DateHead, dateColumnCount, useDateDisplay, type DateDisplay } from "@/components/calendar/report-dates";
const REPORT_TYPES: { value: ComplianceReportType; label: string }[] = [
  { value: "sales_register", label: "Sales Register" },
  { value: "purchase_register", label: "Purchase Register" },
  { value: "vat_return", label: "VAT Return" },
  { value: "tds_report", label: "TDS Report" },
  { value: "tds_payable", label: "TDS Payable" },
  { value: "tax_payment_report", label: "Tax Payment Report" },
  { value: "monthly_compliance_report", label: "Monthly Compliance Report" },
];

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export function ReportsViewer({ allowedTypes }: { allowedTypes?: ComplianceReportType[] } = {}) {
  const types = allowedTypes ? REPORT_TYPES.filter((r) => allowedTypes.includes(r.value)) : REPORT_TYPES;
  const [type, setType] = useState<ComplianceReportType>(types[0]?.value ?? "sales_register");
  const calendar = useCalendar();
  const [initial] = useState(() => presetRange("this_month", calendar));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [mode, setMode] = useDateDisplay();
  const [loading, setLoading] = useState(false);
  const { setError, dialog } = useErrorDialog();
  const [result, setResult] = useState<Awaited<ReturnType<typeof generateReport>> | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const r = await generateReport({ type, from, to });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Report</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as ComplianceReportType);
              setResult(null);
            }}
            className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3"
          >
            {types.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {type !== "tds_payable" && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <DatePicker value={from} onChange={(v) => setFrom(v)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <DatePicker value={to} onChange={(v) => setTo(v)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3" />
            </div>
          </>
        )}
        <DateDisplayControl value={mode} onChange={setMode} />
        <button type="button" disabled={loading} onClick={handleGenerate} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
          {loading ? "Generating..." : "Generate"}
        </button>
      </div>

      {dialog}

      {result && <ReportOutput type={type} result={result} mode={mode} />}
    </div>
  );
}

function ReportOutput({ type, result, mode }: { type: ComplianceReportType; result: NonNullable<Awaited<ReturnType<typeof generateReport>>>; mode: DateDisplay }) {
  if (type === "sales_register") {
    const r = result as { rows: { invoiceNumber: string; invoiceDate: string; customerName: string; subtotal: string; taxAmount: string; total: string; status: string }[]; totalSubtotal: number; totalTax: number; totalAmount: number };
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Invoice #</th>
              <DateHead mode={mode} />
              <th className="px-2.5 py-1.5 font-medium">Customer</th>
              <th className="px-2.5 py-1.5 font-medium">Subtotal</th>
              <th className="px-2.5 py-1.5 font-medium">Tax</th>
              <th className="px-2.5 py-1.5 font-medium">Total</th>
              <th className="px-2.5 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-2.5 py-1.5 font-mono">{row.invoiceNumber}</td>
                <DateCells mode={mode} value={row.invoiceDate} />
                <td className="px-2.5 py-1.5">{row.customerName}</td>
                <td className="px-2.5 py-1.5">{fmt(Number(row.subtotal))}</td>
                <td className="px-2.5 py-1.5">{fmt(Number(row.taxAmount))}</td>
                <td className="px-2.5 py-1.5">{fmt(Number(row.total))}</td>
                <td className="px-2.5 py-1.5 capitalize">{row.status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-2.5 py-1.5" colSpan={2 + dateColumnCount(mode)}>
                Total
              </td>
              <td className="px-2.5 py-1.5">{fmt(r.totalSubtotal)}</td>
              <td className="px-2.5 py-1.5">{fmt(r.totalTax)}</td>
              <td className="px-2.5 py-1.5">{fmt(r.totalAmount)}</td>
              <td className="px-2.5 py-1.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (type === "purchase_register") {
    const r = result as { rows: { billNumber: string; billDate: string; vendorName: string; subtotal: string; taxAmount: string; total: string; status: string }[]; totalSubtotal: number; totalTax: number; totalAmount: number };
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Bill #</th>
              <DateHead mode={mode} />
              <th className="px-2.5 py-1.5 font-medium">Supplier</th>
              <th className="px-2.5 py-1.5 font-medium">Subtotal</th>
              <th className="px-2.5 py-1.5 font-medium">Tax</th>
              <th className="px-2.5 py-1.5 font-medium">Total</th>
              <th className="px-2.5 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-2.5 py-1.5 font-mono">{row.billNumber}</td>
                <DateCells mode={mode} value={row.billDate} />
                <td className="px-2.5 py-1.5">{row.vendorName}</td>
                <td className="px-2.5 py-1.5">{fmt(Number(row.subtotal))}</td>
                <td className="px-2.5 py-1.5">{fmt(Number(row.taxAmount))}</td>
                <td className="px-2.5 py-1.5">{fmt(Number(row.total))}</td>
                <td className="px-2.5 py-1.5 capitalize">{row.status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-2.5 py-1.5" colSpan={2 + dateColumnCount(mode)}>
                Total
              </td>
              <td className="px-2.5 py-1.5">{fmt(r.totalSubtotal)}</td>
              <td className="px-2.5 py-1.5">{fmt(r.totalTax)}</td>
              <td className="px-2.5 py-1.5">{fmt(r.totalAmount)}</td>
              <td className="px-2.5 py-1.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (type === "vat_return") {
    const r = result as { outputVat: number; inputVat: number; netVatPayable: number; salesTaxable: number; purchasesTaxable: number; breakdown?: { salesVat: number; salesReturnsVat: number; purchasesVat: number; expensesVat: number; purchaseReturnsVat: number } };
    return (
      <div className="w-80 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm">
        <Row label="Taxable sales" value={r.salesTaxable} />
        {r.breakdown && r.breakdown.salesReturnsVat > 0 && <Row label="  Sales VAT" value={r.breakdown.salesVat} />}
        {r.breakdown && r.breakdown.salesReturnsVat > 0 && <Row label="  Less: sales returns" value={-r.breakdown.salesReturnsVat} />}
        <Row label="Output VAT" value={r.outputVat} />
        <Row label="Taxable purchases" value={r.purchasesTaxable} />
        {r.breakdown && (r.breakdown.expensesVat > 0 || r.breakdown.purchaseReturnsVat > 0) && <Row label="  Purchases VAT" value={r.breakdown.purchasesVat} />}
        {r.breakdown && r.breakdown.expensesVat > 0 && <Row label="  Expenses VAT" value={r.breakdown.expensesVat} />}
        {r.breakdown && r.breakdown.purchaseReturnsVat > 0 && <Row label="  Less: purchase returns" value={-r.breakdown.purchaseReturnsVat} />}
        <Row label="Input VAT" value={r.inputVat} />
        <div className="border-t border-gray-200 pt-1">
          <Row label="Net VAT payable" value={r.netVatPayable} bold />
        </div>
      </div>
    );
  }

  if (type === "tds_report") {
    const r = result as { rows: { expenseNumber: string; expenseDate: string; payee: string; taxableAmount: string; tdsAmount: string; heading: string }[]; byHeading: { key: string | null; name: string; taxable: number; withheld: number }[]; totalTaxable: number; totalTds: number };
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Reference</th>
              <DateHead mode={mode} />
              <th className="px-2.5 py-1.5 font-medium">Payee</th>
              <th className="px-2.5 py-1.5 font-medium">Taxable amount</th>
              <th className="px-2.5 py-1.5 font-medium">TDS</th>
            </tr>
          </thead>
          <tbody>
            {r.byHeading.map((h) => (
              <Fragment key={h.key ?? "none"}>
                <tr className="border-t border-gray-200 bg-gray-50 font-medium">
                  <td className="px-2.5 py-1.5" colSpan={2 + dateColumnCount(mode)}>
                    {h.name}
                  </td>
                  <td className="px-2.5 py-1.5">{fmt(h.taxable)}</td>
                  <td className="px-2.5 py-1.5">{fmt(h.withheld)}</td>
                </tr>
                {r.rows
                  .filter((row) => row.heading === h.name)
                  .map((row, i) => (
                    <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                      <td className="py-2 pl-8 pr-4 font-mono">{row.expenseNumber}</td>
                      <DateCells mode={mode} value={row.expenseDate} />
                      <td className="px-2.5 py-1.5">{row.payee}</td>
                      <td className="px-2.5 py-1.5">{fmt(Number(row.taxableAmount))}</td>
                      <td className="px-2.5 py-1.5">{fmt(Number(row.tdsAmount))}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
            {r.rows.length === 0 && (
              <tr>
                <td colSpan={4 + dateColumnCount(mode)} className="px-4 py-6 text-center text-gray-400">
                  No TDS was withheld in this period
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-2.5 py-1.5" colSpan={2 + dateColumnCount(mode)}>
                Total
              </td>
              <td className="px-2.5 py-1.5">{fmt(r.totalTaxable)}</td>
              <td className="px-2.5 py-1.5">{fmt(r.totalTds)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (type === "tds_payable") {
    return (
      <div className="w-64 rounded-lg border border-gray-300 bg-white p-4">
        <Row label="TDS Payable balance" value={(result as { balance: number }).balance} bold />
      </div>
    );
  }

  if (type === "tax_payment_report") {
    const r = result as {
      vatReturn: { outputVat: number; inputVat: number; netVatPayable: number };
      tds: { totalTds: number };
      tdsPayableBalance: number;
      vatPayableBalance: number;
    };
    return (
      <div className="w-80 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm">
        <Row label="Output VAT" value={r.vatReturn.outputVat} />
        <Row label="Input VAT" value={r.vatReturn.inputVat} />
        <Row label="Net VAT payable" value={r.vatReturn.netVatPayable} />
        <Row label="TDS withheld (period)" value={r.tds.totalTds} />
        <div className="border-t border-gray-200 pt-1">
          <Row label="VAT Payable balance" value={r.vatPayableBalance} />
          <Row label="TDS Payable balance" value={r.tdsPayableBalance} bold />
        </div>
      </div>
    );
  }

  if (type === "monthly_compliance_report") {
    const r = result as unknown as { salesTotal: number; purchasesTotal: number; vatReturn: { netVatPayable: number }; tds: { totalTds: number }; tdsPayableBalance: number; vatPayableBalance: number };
    return (
      <div className="w-80 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm">
        <Row label="Sales (period)" value={r.salesTotal} />
        <Row label="Purchases (period)" value={r.purchasesTotal} />
        <Row label="Net VAT payable" value={r.vatReturn.netVatPayable} />
        <Row label="TDS withheld (period)" value={r.tds.totalTds} />
        <div className="border-t border-gray-200 pt-1">
          <Row label="VAT Payable balance" value={r.vatPayableBalance} />
          <Row label="TDS Payable balance" value={r.tdsPayableBalance} bold />
        </div>
      </div>
    );
  }

  return null;
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span>{fmt(value)}</span>
    </div>
  );
}
