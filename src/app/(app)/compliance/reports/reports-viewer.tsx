"use client";

import { useState } from "react";
import { generateReport } from "../actions";
import type { ComplianceReportType } from "@/lib/compliance/reports";

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
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

export function ReportsViewer() {
  const [type, setType] = useState<ComplianceReportType>("sales_register");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {REPORT_TYPES.map((r) => (
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
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          </>
        )}
        <button type="button" disabled={loading} onClick={handleGenerate} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
          {loading ? "Generating..." : "Generate"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && <ReportOutput type={type} result={result} />}
    </div>
  );
}

function ReportOutput({ type, result }: { type: ComplianceReportType; result: NonNullable<Awaited<ReturnType<typeof generateReport>>> }) {
  if (type === "sales_register") {
    const r = result as { rows: { invoiceNumber: string; invoiceDate: string; customerName: string; subtotal: string; taxAmount: string; total: string; status: string }[]; totalSubtotal: number; totalTax: number; totalAmount: number };
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice #</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Subtotal</th>
              <th className="px-4 py-2 font-medium">Tax</th>
              <th className="px-4 py-2 font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono">{row.invoiceNumber}</td>
                <td className="px-4 py-2">{row.invoiceDate}</td>
                <td className="px-4 py-2">{row.customerName}</td>
                <td className="px-4 py-2">{fmt(Number(row.subtotal))}</td>
                <td className="px-4 py-2">{fmt(Number(row.taxAmount))}</td>
                <td className="px-4 py-2">{fmt(Number(row.total))}</td>
                <td className="px-4 py-2 capitalize">{row.status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-4 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-2">{fmt(r.totalSubtotal)}</td>
              <td className="px-4 py-2">{fmt(r.totalTax)}</td>
              <td className="px-4 py-2">{fmt(r.totalAmount)}</td>
              <td className="px-4 py-2"></td>
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
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Bill #</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Supplier</th>
              <th className="px-4 py-2 font-medium">Subtotal</th>
              <th className="px-4 py-2 font-medium">Tax</th>
              <th className="px-4 py-2 font-medium">Total</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono">{row.billNumber}</td>
                <td className="px-4 py-2">{row.billDate}</td>
                <td className="px-4 py-2">{row.vendorName}</td>
                <td className="px-4 py-2">{fmt(Number(row.subtotal))}</td>
                <td className="px-4 py-2">{fmt(Number(row.taxAmount))}</td>
                <td className="px-4 py-2">{fmt(Number(row.total))}</td>
                <td className="px-4 py-2 capitalize">{row.status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-4 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-2">{fmt(r.totalSubtotal)}</td>
              <td className="px-4 py-2">{fmt(r.totalTax)}</td>
              <td className="px-4 py-2">{fmt(r.totalAmount)}</td>
              <td className="px-4 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (type === "vat_return") {
    const r = result as { outputVat: number; inputVat: number; netVatPayable: number; salesTaxable: number; purchasesTaxable: number };
    return (
      <div className="w-80 rounded-lg border border-gray-300 bg-white p-4 space-y-1 text-sm">
        <Row label="Taxable sales" value={r.salesTaxable} />
        <Row label="Output VAT" value={r.outputVat} />
        <Row label="Taxable purchases" value={r.purchasesTaxable} />
        <Row label="Input VAT" value={r.inputVat} />
        <div className="border-t border-gray-200 pt-1">
          <Row label="Net VAT payable" value={r.netVatPayable} bold />
        </div>
      </div>
    );
  }

  if (type === "tds_report") {
    const r = result as { rows: { expenseNumber: string; expenseDate: string; payee: string; taxableAmount: string; tdsAmount: string }[]; totalTaxable: number; totalTds: number };
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Expense #</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Payee</th>
              <th className="px-4 py-2 font-medium">Taxable amount</th>
              <th className="px-4 py-2 font-medium">TDS</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-4 py-2 font-mono">{row.expenseNumber}</td>
                <td className="px-4 py-2">{row.expenseDate}</td>
                <td className="px-4 py-2">{row.payee}</td>
                <td className="px-4 py-2">{fmt(Number(row.taxableAmount))}</td>
                <td className="px-4 py-2">{fmt(Number(row.tdsAmount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-4 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-2">{fmt(r.totalTaxable)}</td>
              <td className="px-4 py-2">{fmt(r.totalTds)}</td>
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
