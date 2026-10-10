import { requireTenantSession, can } from "@/lib/session";
import { cashByMode } from "@/lib/ledger/cash-by-mode";
import { validateADDate } from "@/lib/calendar";
import { getFiscalRange, getActiveFiscalYear, fiscalYearDefaultRange } from "@/lib/fiscal";
import { D } from "@/components/calendar/date-text";
import { ReportFilter } from "@/components/calendar/report-filter";
import { AccountLink } from "../account-link";
import { BackButton } from "@/components/ui/back-button";

const asIso = (v: string | string[] | undefined) => (typeof v === "string" && validateADDate(v) ? v : null);
const fmt = (n: number) => n.toFixed(2);

export default async function ReceiptsByModePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const sp = await searchParams;
  const [fiscal, activeFiscalYear] = await Promise.all([getFiscalRange(session.tenantId), getActiveFiscalYear(session.tenantId)]);
  const dflt = fiscalYearDefaultRange(activeFiscalYear, session.calendar);
  let from = asIso(sp.from) ?? dflt.from;
  const to = asIso(sp.to) ?? dflt.to;
  if (from > to) from = to;

  const { byMode, byModeAndAccount, accountNames } = await cashByMode(session.tenantId, from, to);
  const totalReceived = byMode.reduce((s, m) => s + m.received, 0);
  const totalPaid = byMode.reduce((s, m) => s + m.paid, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton href="/reports" label="Back to Reports" />
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Receipts &amp; Payments by Mode</h1>
      </div>
      <ReportFilter from={from} to={to} fiscal={fiscal} />
      <p className="text-sm text-gray-500">
        <D value={from} /> – <D value={to} />. Money received and paid through each payment mode. Voided and edited entries and moves between your own accounts (Inter-Transfers) are left out.
      </p>

      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-700">By Mode</h2>
        <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Mode</th>
              <th className="px-4 py-2 font-medium text-right">Received</th>
              <th className="px-4 py-2 font-medium text-right">Paid</th>
              <th className="px-4 py-2 font-medium text-right">Net</th>
              <th className="px-4 py-2 font-medium text-right">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {byMode.map((m) => (
              <tr key={m.mode} className="border-t border-gray-100">
                <td className="px-4 py-2">{m.mode}</td>
                <td className="px-4 py-2 text-right">{m.received ? fmt(m.received) : ""}</td>
                <td className="px-4 py-2 text-right">{m.paid ? fmt(m.paid) : ""}</td>
                <td className="px-4 py-2 text-right">{fmt(m.net)}</td>
                <td className="px-4 py-2 text-right">{m.transactions}</td>
              </tr>
            ))}
            {byMode.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No money received or paid in this period
                </td>
              </tr>
            )}
            {byMode.length > 0 && (
              <tr className="border-t-2 border-gray-300 font-medium">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">{fmt(totalReceived)}</td>
                <td className="px-4 py-2 text-right">{fmt(totalPaid)}</td>
                <td className="px-4 py-2 text-right">{fmt(totalReceived - totalPaid)}</td>
                <td className="px-4 py-2 text-right"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {byModeAndAccount.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-gray-700">By Mode and Account</h2>
          <table className="w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium text-right">Received</th>
                <th className="px-4 py-2 font-medium text-right">Paid</th>
                <th className="px-4 py-2 font-medium text-right">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {byModeAndAccount.map((r) => (
                <tr key={r.mode + r.accountId} className="border-t border-gray-100">
                  <td className="px-4 py-2">{r.mode}</td>
                  <td className="px-4 py-2">
                    <AccountLink accountId={r.accountId} from={from} to={to}>
                      {accountNames.get(r.accountId) ?? r.accountId}
                    </AccountLink>
                  </td>
                  <td className="px-4 py-2 text-right">{r.received ? fmt(r.received) : ""}</td>
                  <td className="px-4 py-2 text-right">{r.paid ? fmt(r.paid) : ""}</td>
                  <td className="px-4 py-2 text-right">{r.transactions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
