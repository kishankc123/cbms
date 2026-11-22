import type { DateRange } from "@/lib/calendar";
import { margin, money, percentText, changePercent, type Pair } from "@/lib/ledger/pnl-compare-rules";
import type { Series, SeriesRow, SeriesSection } from "@/lib/ledger/pnl-series-rules";
import { FoldRows } from "../profit-and-loss/fold-rows";
import { AccountLink } from "../account-link";
import { NUM, tone } from "../profit-and-loss/comparative-table";

// Columns of a series: the quarter's three months, then the quarter, then the same quarter a year earlier.
const QUARTER = 3;
const LAST_YEAR = 4;
const th = "px-2 py-1.5 font-medium text-right";

const pair = (v: number[]): Pair => ({ cur: v[QUARTER], prev: v[LAST_YEAR] });

// The amounts of one line: the five columns, then the change against last year and the change in percent.
function Cells({ v }: { v: number[] }) {
  const p = pair(v);
  const c = Math.round((p.cur - p.prev) * 100) / 100;
  return (
    <>
      {v.map((n, i) => (
        <td key={i} className={`${NUM} ${i === QUARTER ? "font-medium" : ""}`}>
          {money(n)}
        </td>
      ))}
      <td className={`${NUM} ${tone(c)}`}>{money(c)}</td>
      <td className={`${NUM} ${tone(c)}`}>{percentText(changePercent(p))}</td>
    </>
  );
}

function Total({ label, v, strong }: { label: string; v: number[]; strong?: boolean }) {
  return (
    <tr className={`border-t border-line-strong font-medium ${strong ? "bg-surface-2" : ""}`}>
      <td className="px-2 py-1.5" colSpan={2}>
        {label}
      </td>
      <Cells v={v} />
    </tr>
  );
}

function Percent({ label, profit, income }: { label: string; profit: number[]; income: number[] }) {
  return (
    <tr className="text-ink-2">
      <td className="px-2 py-1" colSpan={2}>
        {label}
      </td>
      {profit.map((_, i) => {
        const m = margin({ cur: profit[i], prev: 0 }, { cur: income[i], prev: 0 }).cur;
        return (
          <td key={i} className={NUM}>
            {m === null ? "-" : `${m}%`}
          </td>
        );
      })}
      <td colSpan={2} />
    </tr>
  );
}

// The rows of a heading in order, with the ones that share a sub-heading (Performance incentives) kept together.
type Chunk = { subGroup: SeriesRow["subGroup"]; rows: SeriesRow[] };
function chunksOf(rows: SeriesRow[]): Chunk[] {
  const out: Chunk[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.subGroup && last.subGroup?.id === r.subGroup.id) last.rows.push(r);
    else out.push({ subGroup: r.subGroup, rows: [r] });
  }
  return out;
}

function Rows({ section, range }: { section: SeriesSection; range: DateRange }) {
  return section.headings.map((h) => {
    let shown = 0;
    return chunksOf(h.rows).map((c) => {
      const lead = shown === 0 ? h.name : "";
      const border = shown === 0;
      shown += 1;
      const line = (r: SeriesRow, indent: boolean, first: boolean) => (
        <tr key={r.accountId} className={`transition-colors hover:bg-hover ${first && border ? "border-t border-line" : ""}`}>
          <td className="px-2 py-1 font-medium">{first ? lead : ""}</td>
          <td className={`px-2 py-1 ${indent ? "pl-6" : ""}`}>
            <AccountLink accountId={r.accountId} from={range.from} to={range.to} className={r.sub ? undefined : "text-ink-3 hover:underline"}>
              {r.sub || h.name}
            </AccountLink>
          </td>
          <Cells v={r.values} />
        </tr>
      );
      if (!c.subGroup) return line(c.rows[0], false, true);
      const total = c.rows[0].values.map((_, i) => Math.round(c.rows.reduce((s, r) => s + r.values[i], 0) * 100) / 100);
      return (
        <FoldRows key={c.subGroup.id} lead={lead} label={c.subGroup.name} topBorder={border} amounts={<Cells v={total} />}>
          {c.rows.map((r) => line(r, true, false))}
        </FoldRows>
      );
    });
  });
}

/** A quarter's Profit & Loss: each of its months, the quarter, the same quarter a year earlier, and the change. `months` are the three month headings. */
export function QuarterlyPnlTable({ data, months, quarter, lastYear, range }: { data: Series; months: string[]; quarter: string; lastYear: string; range: DateRange }) {
  const gap = (
    <tr aria-hidden>
      <td colSpan={9} className="h-3" />
    </tr>
  );
  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <colgroup>
        <col className="w-[13%]" />
        <col className="w-[17%]" />
        {Array.from({ length: 5 }, (_, i) => (
          <col key={i} className="w-[9.5%]" />
        ))}
        <col className="w-[9%]" />
        <col className="w-[7%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-line-strong">
          <th className="px-2 py-1.5 text-left font-medium">Heading</th>
          <th className="px-2 py-1.5 text-left font-medium">Sub-heading</th>
          {[...months, quarter, lastYear].map((h, i) => (
            <th key={i} className={th}>
              {h}
            </th>
          ))}
          <th className={th}>Inc/(Dec)</th>
          <th className={th}>Change %</th>
        </tr>
      </thead>
      <tbody>
        <Rows section={data.income} range={range} />
        <Total label="Total income" v={data.income.totals} />
        {gap}
        <Rows section={data.cost} range={range} />
        {data.cost.headings.length > 0 && <Total label="Total cost of sales" v={data.cost.totals} />}
        <Total label="Gross profit" v={data.grossProfit} strong />
        <Percent label="In percentage of income" profit={data.grossProfit} income={data.income.totals} />
        {gap}
        <Rows section={data.expenses} range={range} />
        <Total label="Total expenses" v={data.expenses.totals} />
        <Total label="Net profit / (loss)" v={data.netProfit} strong />
        <Percent label="In percentage of income" profit={data.netProfit} income={data.income.totals} />
      </tbody>
    </table>
  );
}
