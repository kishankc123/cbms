import type { DateRange } from "@/lib/calendar";
import type { CashFlowComparison } from "@/lib/ledger/cashflow-compare-rules";
import type { Pair } from "@/lib/ledger/pnl-compare-rules";
import { Rows, Total } from "../profit-and-loss/comparative-table";

const th = "px-2.5 py-1.5 font-medium";

/** The cash flow statement in the Profit & Loss format: activities as headings, this period against the other with the change. Changes are not coloured, as on the balance sheet. */
export function CashFlowTable({ data, range, currentLabel, previousLabel }: { data: CashFlowComparison; range: DateRange; currentLabel: string; previousLabel?: string }) {
  const single = previousLabel === undefined;
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
        <Rows section={data.operating} range={range} single={single} neutral />
        {total("Net cash from operating activities", data.operating)}
        {gap}
        <Rows section={data.investing} range={range} single={single} neutral />
        {total("Net cash from investing activities", data.investing)}
        {gap}
        <Rows section={data.financing} range={range} single={single} neutral />
        {total("Net cash from financing activities", data.financing)}
        {gap}
        {total("Net change in cash", data.netChange, true)}
        {total("Cash and bank at the start", data.opening)}
        {total("Cash and bank at the end", data.closing, true)}
      </tbody>
    </table>
  );
}
