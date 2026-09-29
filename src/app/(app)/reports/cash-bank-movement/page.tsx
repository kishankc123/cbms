import Link from "next/link";
import { requireTenantSession, can } from "@/lib/session";
import { cashBankMovement } from "@/lib/ledger/reports";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { resolveSourceLink } from "@/lib/ledger/source-link";
import { AccountLink } from "../account-link";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);

const SOURCE_TYPE_LABEL: Record<string, string> = {
  sale: "Sale",
  purchase: "Purchase",
  expense: "Expense",
  payment: "Payment",
  receipt: "Receipt",
  bank_adjustment: "Bank Adjustment",
  manual: "Manual Journal",
  payroll: "Payroll",
  opening_balance: "Opening Balance",
  inter_transfer: "Inter-Transfer",
  tax_assessment: "Tax Assessment",
  sales_return: "Sales Return",
  purchase_return: "Purchase Return",
  advance_application: "Advance Application",
  stock_adjustment: "Stock Adjustment",
};

const fmt = (n: number) => n.toFixed(2);

export default async function CashBankMovementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const fiscal = await getFiscalRange(session.tenantId);
  const activeFiscalYear = await getActiveFiscalYear(session.tenantId);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const { accounts, bySourceType } = await cashBankMovement(session.tenantId, new Date(from + "T00:00:00Z"), new Date(to + "T00:00:00Z"));

  const totalOpening = accounts.reduce((s, a) => s + a.openingBalance, 0);
  const totalIn = accounts.reduce((s, a) => s + a.totalIn, 0);
  const totalOut = accounts.reduce((s, a) => s + a.totalOut, 0);
  const totalClosing = accounts.reduce((s, a) => s + a.closingBalance, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Cash/Bank Movement</h1>
        <Link href="/reports" className="text-sm text-[var(--color-primary)] hover:underline">
          ← Reports
        </Link>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />
      <p className="text-sm text-gray-500">
        <D value={from} /> – <D value={to} />
      </p>

      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-700">By Account</h2>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium text-right">Opening Balance</th>
              <th className="px-4 py-2 font-medium text-right">Total In</th>
              <th className="px-4 py-2 font-medium text-right">Total Out</th>
              <th className="px-4 py-2 font-medium text-right">Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <AccountLink accountId={a.accountId} from={from} to={to}>
                    {a.code} — {a.name}
                  </AccountLink>
                </td>
                <td className="px-4 py-2 text-right">{fmt(a.openingBalance)}</td>
                <td className="px-4 py-2 text-right">{fmt(a.totalIn)}</td>
                <td className="px-4 py-2 text-right">{fmt(a.totalOut)}</td>
                <td className="px-4 py-2 text-right">{fmt(a.closingBalance)}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No cash or bank accounts found
                </td>
              </tr>
            )}
            {accounts.length > 0 && (
              <tr className="border-t-2 border-gray-300 font-medium">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">{fmt(totalOpening)}</td>
                <td className="px-4 py-2 text-right">{fmt(totalIn)}</td>
                <td className="px-4 py-2 text-right">{fmt(totalOut)}</td>
                <td className="px-4 py-2 text-right">{fmt(totalClosing)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-700">By Transaction Type</h2>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium text-right">Total In</th>
              <th className="px-4 py-2 font-medium text-right">Total Out</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {bySourceType.map((s) => {
              const source = resolveSourceLink(s.sourceType);
              return (
                <tr key={s.sourceType} className="border-t border-gray-100">
                  <td className="px-4 py-2">{SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}</td>
                  <td className="px-4 py-2 text-right">{s.totalIn ? fmt(s.totalIn) : ""}</td>
                  <td className="px-4 py-2 text-right">{s.totalOut ? fmt(s.totalOut) : ""}</td>
                  <td className="px-4 py-2">
                    {source ? (
                      <Link href={source.href} className="text-xs text-[var(--color-primary)] hover:underline whitespace-nowrap">
                        {source.label}
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {bySourceType.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No cash or bank movement in this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
