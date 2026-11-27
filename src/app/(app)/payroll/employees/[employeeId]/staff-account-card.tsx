import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import type { buildStatement } from "@/lib/ledger/party-ledger";

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What a balance means, in words: positive is owed to the employee, negative is owed by them. */
const words = (balance: number) => (balance > 0.004 ? `We owe ${money.format(balance)}` : balance < -0.004 ? `Owes us ${money.format(-balance)}` : "Settled");

/** The employee's one staff account: the balance at the top of their page, with the statement behind it. */
export function StaffAccountCard({ statement }: { statement: ReturnType<typeof buildStatement> }) {
  const { openingBalance, closingBalance, rows } = statement;
  if (rows.length === 0 && openingBalance === 0) return null;
  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-ink-2">Staff account balance</p>
          <p className="flex items-center gap-2 text-base font-semibold tabular-nums text-ink">
            {money.format(Math.abs(closingBalance))}
            <StatusPill tone={Math.abs(closingBalance) <= 0.004 ? "success" : closingBalance > 0 ? "pending" : "action"}>{closingBalance > 0.004 ? "Company owes employee" : closingBalance < -0.004 ? "Employee owes company" : "Settled"}</StatusPill>
          </p>
        </div>
        <p className="text-xs text-ink-3">Salary earned, advances and salary payments are all on this one account.</p>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-accent">Statement</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Date</th>
                <th className="px-2.5 py-1.5 font-medium">What happened</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Debit</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Credit</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {openingBalance !== 0 && (
                <tr className="border-b border-line">
                  <td className="px-2.5 py-1.5" />
                  <td className="px-2.5 py-1.5">Opening balance</td>
                  <td />
                  <td />
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">{words(openingBalance)}</td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line transition-colors hover:bg-hover">
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    <D value={r.date} />
                  </td>
                  <td className="px-2.5 py-1.5">{r.details}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{r.debit ? money.format(r.debit) : ""}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{r.credit ? money.format(r.credit) : ""}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">{words(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
