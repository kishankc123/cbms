import { requireTenantSession, can } from "@/lib/session";
import { salesSummary } from "@/lib/ledger/sales-summary";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const fmt = (n: number) => n.toFixed(2);

export default async function SalesSummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const s = await salesSummary(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Sales Summary</h1>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />

      <div>
        <p className="mb-2 text-sm text-gray-500">
          <D value={from} /> – <D value={to} />
        </p>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <tbody>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Sales Invoices ({s.invoiceCount})</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Gross Amount</td>
              <td className="px-4 py-2 text-right">{fmt(s.grossAmount)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Discount</td>
              <td className="px-4 py-2 text-right">{fmt(s.discountAmount)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Taxable Amount</td>
              <td className="px-4 py-2 text-right">{fmt(s.subtotal)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Tax Collected</td>
              <td className="px-4 py-2 text-right">{fmt(s.taxAmount)}</td>
            </tr>
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Invoiced</td>
              <td className="px-4 py-2 text-right">{fmt(s.totalInvoiced)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Sales Returns ({s.returnCount})</td>
            </tr>
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Returned</td>
              <td className="px-4 py-2 text-right">{fmt(s.returnAmount)}</td>
            </tr>
            <tr className="border-t-2 border-gray-300 font-semibold">
              <td className="px-4 py-2">Net Sales</td>
              <td className="px-4 py-2 text-right">{fmt(s.netSales)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
