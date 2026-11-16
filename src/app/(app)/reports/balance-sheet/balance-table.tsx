import type { DateRange } from "@/lib/calendar";
import { money, type BalanceComparison, type Pair } from "@/lib/ledger/pnl-compare-rules";
import { NUM, Rows, Total } from "../profit-and-loss/comparative-table";

const th = "px-2.5 py-1.5 font-medium";

/** The balance sheet in the Profit & Loss format: headings and sub-headings, as at two dates (or one) with the change. A balance sheet has no better or worse, so changes are not coloured. */
export function BalanceTable({ data, currentLabel, previousLabel, to }: { data: BalanceComparison; currentLabel: string; previousLabel?: string; to: string }) {
  const single = previousLabel === undefined;
  const range: DateRange = { from: "", to };
  const gap = (
    <tr aria-hidden>
      <td colSpan={single ? 3 : 6} className="h-3" />
    </tr>
  );
  const total = (label: string, p: Pair, strong?: boolean) => <Total label={label} p={p} single={single} strong={strong} neutral />;
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col className={single ? "w-[28%]" : "w-[17%]"} />
        <col className={single ? "w-[44%]" : "w-[25%]"} />
        <col className={single ? "w-[28%]" : "w-[15%]"} />
        {!single && <col className="w-[15%]" />}
        {!single && <col className="w-[15%]" />}
        {!single && <col className="w-[13%]" />}
      </colgroup>
      <thead>
        <tr className="border-b border-line-strong">
          <th className={`${th} text-left`}>Heading</th>
          <th className={`${th} text-left`}>Sub-heading</th>
          <th className={`${th} text-right`}>{currentLabel}</th>
          {!single && (
            <>
              <th className={`${th} text-right`}>{previousLabel}</th>
              <th className={`${th} text-right`}>Inc/(Dec)</th>
              <th className={`${th} text-right`}>Change %</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        <Rows section={data.assets} range={range} single={single} neutral />
        {total("Total assets", data.assets, true)}
        {gap}
        <Rows section={data.liabilities} range={range} single={single} neutral />
        {total("Total liabilities", data.liabilities)}
        {gap}
        <Rows section={data.equity} range={range} single={single} neutral />
        {total("Total equity", data.equity)}
        {total("Total liabilities and equity", data.liabilitiesAndEquity, true)}
        {(data.difference.cur !== 0 || data.difference.prev !== 0) && (
          <tr className="text-[var(--danger-text)]">
            <td colSpan={2} className="px-2.5 py-1">Difference (assets less liabilities and equity)</td>
            <td className={NUM}>{money(data.difference.cur)}</td>
            {!single && <td className={NUM}>{money(data.difference.prev)}</td>}
            {!single && <td colSpan={2} />}
          </tr>
        )}
      </tbody>
    </table>
  );
}
