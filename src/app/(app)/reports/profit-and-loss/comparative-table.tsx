import type { DateRange } from "@/lib/calendar";
import { change, changePercent, margin, money, percentText, type Comparison, type Pair, type Row, type Section } from "@/lib/ledger/pnl-compare-rules";
import { AccountLink } from "../account-link";
import { FoldRows, Marker } from "./fold-rows";

// Green is better for profit, red worse. A balance sheet has no better or worse direction, so it passes `neutral`.
export const tone = (n: number, neutral?: boolean) => (neutral ? "" : n > 0 ? "text-[var(--success-text)]" : n < 0 ? "text-[var(--danger-text)]" : "");
export const NUM = "px-2.5 py-1 text-right tabular-nums";

// The columns after the current amount. With one period there is nothing to compare, so they are left out.
// With two: the earlier amount, the change and the change as a percent. Positive is better for profit, so it is green.
function Others({ p, single, neutral }: { p: Pair; single: boolean; neutral?: boolean }) {
  if (single) return null;
  const c = change(p);
  return (
    <>
      <td className={NUM}>{money(p.prev)}</td>
      <td className={`${NUM} ${tone(c, neutral)}`}>{money(c)}</td>
      <td className={`${NUM} ${tone(c, neutral)}`}>{percentText(changePercent(p))}</td>
    </>
  );
}

export function Total({ label, p, single, strong, neutral }: { label: string; p: Pair; single: boolean; strong?: boolean; neutral?: boolean }) {
  return (
    <tr className={`border-t border-line-strong font-medium ${strong ? "bg-surface-2 text-[13.5px]" : ""}`}>
      <td className="px-2.5 py-1.5" colSpan={2}>
        {label}
      </td>
      <td className={NUM}>{money(p.cur)}</td>
      <Others p={p} single={single} neutral={neutral} />
    </tr>
  );
}

function Percent({ label, cur, prev, single }: { label: string; cur: number | null; prev: number | null; single: boolean }) {
  const pts = cur === null || prev === null ? null : cur - prev;
  return (
    <tr className="text-ink-2">
      <td className="px-2.5 py-1" colSpan={2}>
        {label}
      </td>
      <td className={NUM}>{cur === null ? "-" : `${cur}%`}</td>
      {!single && (
        <>
          <td className={NUM}>{prev === null ? "-" : `${prev}%`}</td>
          <td className={`${NUM} ${tone(pts ?? 0)}`}>{pts ? `${pts < 0 ? `(${Math.abs(pts)})` : pts} pts` : "-"}</td>
          <td />
        </>
      )}
    </tr>
  );
}

// The rows of a heading in order, with the ones that share a sub-heading (Performance incentives) kept together.
type Chunk = { subGroup: Row["subGroup"]; rows: Row[] };
function chunksOf(rows: Row[]): Chunk[] {
  const out: Chunk[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.subGroup && last.subGroup?.id === r.subGroup.id) last.rows.push(r);
    else out.push({ subGroup: r.subGroup, rows: [r] });
  }
  return out;
}

export function Rows({ section, range, single, neutral }: { section: Section; range: DateRange; single: boolean; neutral?: boolean }) {
  return section.headings.map((h) => {
    let shown = 0;
    const chunks = chunksOf(h.rows);
    const hasFold = chunks.some((c) => c.subGroup);
    return chunks.map((c) => {
      const lead = shown === 0 ? h.name : "";
      const border = shown === 0;
      shown += 1;
      const line = (r: Row, indent: boolean, first: boolean) => {
        const link = r.accountId ? (
          <AccountLink accountId={r.accountId} from={range.from} to={range.to} className={r.sub ? undefined : "text-ink-3 hover:underline"}>
            {r.sub || h.name}
          </AccountLink>
        ) : (
          r.sub
        );
        return (
        <tr key={r.accountId} className={`transition-colors hover:bg-hover ${first && border ? "border-t border-line" : ""}`}>
          <td className="px-2.5 py-1 font-medium">{first ? lead : ""}</td>
          <td className={`px-2.5 py-1 ${indent ? "pl-10" : ""}`}>
            {hasFold && !indent ? (
              <span className="inline-flex items-center gap-1.5">
                <Marker />
                {link}
              </span>
            ) : (
              link
            )}
          </td>
          <td className={NUM}>{money(r.cur)}</td>
          <Others p={r} single={single} neutral={neutral} />
        </tr>
        );
      };
      if (!c.subGroup) return line(c.rows[0], false, true);
      const total: Pair = { cur: Math.round(c.rows.reduce((s, r) => s + r.cur, 0) * 100) / 100, prev: Math.round(c.rows.reduce((s, r) => s + r.prev, 0) * 100) / 100 };
      return (
        <FoldRows
          key={c.subGroup.id}
          lead={lead}
          label={c.subGroup.name}
          topBorder={border}
          amounts={
            <>
              <td className={NUM}>{money(total.cur)}</td>
              <Others p={total} single={single} neutral={neutral} />
            </>
          }
        >
          {c.rows.map((r) => line(r, true, false))}
        </FoldRows>
      );
    });
  });
}

/**
 * The Profit & Loss table: headings and sub-headings, totals, gross profit and net profit with their percentages.
 * Given `previousLabel` it sets the period against another one, with the change and the change in percent; without it, it shows the one period.
 */
export function ComparativeTable({ data, range, currentLabel, previousLabel }: { data: Comparison; range: DateRange; currentLabel: string; previousLabel?: string }) {
  const single = previousLabel === undefined;
  const cols = single ? 3 : 6;
  const gross = margin(data.grossProfit, data.income);
  const net = margin(data.netProfit, data.income);
  const th = "px-2.5 py-1.5 font-medium";
  const gap = (
    <tr aria-hidden>
      <td colSpan={cols} className="h-3" />
    </tr>
  );
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
        <Rows section={data.income} range={range} single={single} />
        <Total label="Total income" p={data.income} single={single} />
        {gap}
        <Rows section={data.cost} range={range} single={single} />
        {data.cost.headings.length > 0 && <Total label="Total cost of sales" p={data.cost} single={single} />}
        <Total label="Gross profit" p={data.grossProfit} single={single} strong />
        <Percent label="In percentage of income" cur={gross.cur} prev={gross.prev} single={single} />
        {gap}
        <Rows section={data.expenses} range={range} single={single} />
        <Total label="Total expenses" p={data.expenses} single={single} />
        <Total label="Net profit / (loss)" p={data.netProfit} single={single} strong />
        <Percent label="In percentage of income" cur={net.cur} prev={net.prev} single={single} />
        <tr className="text-ink-2">
          <td colSpan={2} />
          <td className={NUM}>{data.netProfit.cur >= 0 ? "Profit" : "Loss"}</td>
          {!single && <td className={NUM}>{data.netProfit.prev >= 0 ? "Profit" : "Loss"}</td>}
          {!single && <td colSpan={2} />}
        </tr>
      </tbody>
    </table>
  );
}
