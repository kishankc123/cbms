"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { DateRange } from "@/lib/calendar";
import type { CashFlowByAccount, FlowLine } from "@/lib/ledger/cashflow-by-account-rules";
import { money } from "@/lib/ledger/pnl-compare-rules";
import { AccountLink } from "../account-link";

const th = "px-2 py-1.5 font-medium text-right";
const num = "px-2 py-1 text-right tabular-nums";

/** One amount: money out in brackets and red, nothing as a dash. */
const Amount = ({ v }: { v: number }) => <td className={`${num} ${v < 0 ? "text-[var(--danger-text)]" : ""}`}>{money(v)}</td>;

/**
 * Cash flow by account: the cash, bank and wallet accounts side by side, with money in and money out in detail. Rows that stand for many people
 * (customers who paid, suppliers who were paid) fold to one line and open to one line each; what is open is what is printed and exported.
 */
export function CashFlowByAccountTable({ data, range }: { data: CashFlowByAccount; range: DateRange }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const cols = data.columns.length + 2;

  const line = (sectionKey: string, l: FlowLine) => {
    const k = `${sectionKey}:${l.key}`;
    const expandable = l.children.length > 0;
    const isOpen = open.has(k);
    return (
      <Fragment key={k}>
        <tr className="transition-colors hover:bg-hover">
          <td className="py-1 pl-5 pr-2">
            {expandable ? (
              <button type="button" aria-expanded={isOpen} onClick={() => toggle(k)} className="inline-flex items-center gap-1.5 text-left hover:underline" title={isOpen ? "Fold the lines under it" : "Show one line for each"}>
                <span className="flex w-3.5 shrink-0 justify-center">
                  <ChevronRight size={13} aria-hidden className={`text-ink-2 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </span>
                {l.label}
              </button>
            ) : l.accountId ? (
              <AccountLink accountId={l.accountId} from={range.from} to={range.to}>
                {l.label}
              </AccountLink>
            ) : (
              l.label
            )}
          </td>
          {l.cells.map((v, i) => (
            <Amount key={i} v={v} />
          ))}
          <Amount v={l.total} />
        </tr>
        {expandable &&
          isOpen &&
          l.children.map((c) => (
            <tr key={`${k}:${c.key}`} className="transition-colors hover:bg-hover">
              <td className="py-1 pl-10 pr-2 text-ink-2">
                {c.accountId ? (
                  <AccountLink accountId={c.accountId} from={range.from} to={range.to}>
                    {c.label}
                  </AccountLink>
                ) : (
                  c.label
                )}
              </td>
              {c.cells.map((v, i) => (
                <Amount key={i} v={v} />
              ))}
              <Amount v={c.total} />
            </tr>
          ))}
      </Fragment>
    );
  };

  const side = (title: string, s: CashFlowByAccount["moneyIn"], totalLabel: string) => (
    <>
      <tr>
        <td colSpan={cols} className="px-2 pb-0.5 pt-3 font-semibold">
          {title}
        </td>
      </tr>
      {s.sections.map((sec) => (
        <Fragment key={sec.key}>
          <tr>
            <td colSpan={cols} className="px-2 pb-0.5 pt-2 font-medium underline decoration-line-strong underline-offset-2">
              {sec.title}
            </td>
          </tr>
          {sec.lines.map((l) => line(sec.key, l))}
        </Fragment>
      ))}
      <tr className="border-t border-line-strong font-medium">
        <td className="px-2 py-1.5">{totalLabel}</td>
        {s.cells.map((v, i) => (
          <Amount key={i} v={v} />
        ))}
        <Amount v={s.total} />
      </tr>
    </>
  );

  if (data.columns.length === 0) {
    return <p className="py-6 text-center text-[13px] text-ink-2">No cash, bank or wallet account has moved in this period.</p>;
  }
  const totalOf = (xs: number[]) => Math.round(xs.reduce((s, v) => s + v, 0) * 100) / 100;

  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col style={{ width: "26%" }} />
        {data.columns.map((c) => (
          <col key={c.accountId} />
        ))}
        <col />
      </colgroup>
      <thead>
        <tr className="border-b border-line-strong">
          <th className="px-2 py-1.5 text-left font-medium">Particulars</th>
          {data.columns.map((c) => (
            <th key={c.accountId} className={th}>
              <AccountLink accountId={c.accountId} from={range.from} to={range.to} className="hover:underline">
                {c.name}
              </AccountLink>
            </th>
          ))}
          <th className={th}>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr className="bg-hover font-medium">
          <td className="px-2 py-1.5">Opening balance</td>
          {data.opening.map((v, i) => (
            <td key={i} className={`${num} ${v < 0 ? "text-[var(--danger-text)]" : ""}`}>
              {money(v)}
            </td>
          ))}
          <td className={num}>{money(totalOf(data.opening))}</td>
        </tr>
        {side("Money in", data.moneyIn, "Money in, total")}
        {side("Money out", data.moneyOut, "Money out, total")}
        <tr aria-hidden>
          <td colSpan={cols} className="h-2" />
        </tr>
        <tr className="border-t border-line-strong bg-hover font-semibold">
          <td className="px-2 py-1.5">Closing balance</td>
          {data.closing.map((v, i) => (
            <td key={i} className={`${num} ${v < 0 ? "text-[var(--danger-text)]" : ""}`}>
              {money(v)}
            </td>
          ))}
          <td className={num}>{money(totalOf(data.closing))}</td>
        </tr>
      </tbody>
    </table>
  );
}
