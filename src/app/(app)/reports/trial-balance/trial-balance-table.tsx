import { money } from "@/lib/ledger/pnl-compare-rules";
import type { Side, TrialBalanceByPeriod } from "@/lib/ledger/trial-balance-rules";
import { AccountLink } from "../account-link";

const NUM = "px-2.5 py-1 text-right tabular-nums";
const th = "px-2.5 py-1.5 text-right font-medium";

// The side with nothing on it is left blank, so a debit balance and a credit balance read apart.
const cells = (s: Side) => (
  <>
    <td className={NUM}>{s.dr ? money(s.dr) : ""}</td>
    <td className={NUM}>{s.cr ? money(s.cr) : ""}</td>
  </>
);

const DebitCredit = () => (
  <>
    <th className={th}>Debit</th>
    <th className={th}>Credit</th>
  </>
);

/** The trial balance grouped by heading. `period` shows opening, movement and closing; without it, one Debit and Credit pair as at the date. */
export function TrialBalanceTable({ data, period, from, to }: { data: TrialBalanceByPeriod; period: boolean; from?: string; to: string }) {
  const cols = period ? 8 : 4;
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col className={period ? "w-[14%]" : "w-[28%]"} />
        <col className={period ? "w-[20%]" : "w-[40%]"} />
        {Array.from({ length: period ? 6 : 2 }, (_, i) => (
          <col key={i} className={period ? "w-[11%]" : "w-[16%]"} />
        ))}
      </colgroup>
      <thead>
        {period && (
          <tr>
            <th colSpan={2} />
            {["Opening", "Movement", "Closing"].map((g) => (
              <th key={g} colSpan={2} className="border-b border-line px-2.5 py-1 text-center font-medium text-ink-2">
                {g}
              </th>
            ))}
          </tr>
        )}
        <tr className="border-b border-line-strong">
          <th className="px-2.5 py-1.5 text-left font-medium">Heading</th>
          <th className="px-2.5 py-1.5 text-left font-medium">Sub-heading</th>
          <DebitCredit />
          {period && <DebitCredit />}
          {period && <DebitCredit />}
        </tr>
      </thead>
      <tbody>
        {data.sections.map((s) => [
          <tr key={s.title} className="bg-surface-2">
            <td colSpan={cols} className="px-2.5 py-1 font-medium">
              {s.title}
            </td>
          </tr>,
          ...s.headings.flatMap((h) =>
            h.rows.map((r, i) => (
              <tr key={r.accountId} className={`transition-colors hover:bg-hover ${i === 0 ? "border-t border-line" : ""}`}>
                <td className="px-2.5 py-1 font-medium">{i === 0 ? h.name : ""}</td>
                <td className="px-2.5 py-1">
                  <AccountLink accountId={r.accountId} from={from} to={to} className={r.sub ? undefined : "text-ink-3 hover:underline"}>
                    {r.sub || h.name}
                  </AccountLink>
                </td>
                {period && cells(r.opening)}
                {period && cells(r.movement)}
                {cells(r.closing)}
              </tr>
            )),
          ),
        ])}
        <tr className="border-t-2 border-line-strong font-medium">
          <td colSpan={2} className="px-2.5 py-1.5">
            Total
          </td>
          {period && cells(data.totals.opening)}
          {period && cells(data.totals.movement)}
          {cells(data.totals.closing)}
        </tr>
      </tbody>
    </table>
  );
}
