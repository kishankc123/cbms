import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { purchaseSummary } from "@/lib/ledger/purchase-summary";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const fmt = (n: number) => n.toFixed(2);

export default async function PurchaseSummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const s = await purchaseSummary(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Purchase Summary</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />

      <div>
        <p className="mb-2 text-sm text-gray-500">
          <D value={from} /> – <D value={to} />
        </p>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <tbody>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Purchase Bills ({s.billCount})</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Taxable Amount</td>
              <td className="px-4 py-2 text-right">{fmt(s.subtotal)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-4 py-2 pl-8">Tax Paid</td>
              <td className="px-4 py-2 text-right">{fmt(s.taxAmount)}</td>
            </tr>
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Billed</td>
              <td className="px-4 py-2 text-right">{fmt(s.totalBilled)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium" colSpan={2}>Purchase Returns ({s.returnCount})</td>
            </tr>
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2">Total Returned</td>
              <td className="px-4 py-2 text-right">{fmt(s.returnAmount)}</td>
            </tr>
            <tr className="border-t-2 border-gray-300 font-semibold">
              <td className="px-4 py-2">Net Purchases</td>
              <td className="px-4 py-2 text-right">{fmt(s.netPurchases)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
