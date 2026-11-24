"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { money } from "@/lib/ledger/pnl-compare-rules";
import { headingTotals, type Side, type TbHeading, type TrialBalanceByPeriod } from "@/lib/ledger/trial-balance-rules";
import { AccountLink } from "../account-link";

const NUM = "px-2.5 py-1 text-right tabular-nums";
const th = "px-2.5 py-1.5 text-right font-medium";

// The side with nothing on it is left blank, so a debit balance and a credit balance read apart.
const cells = (s: Side, bold = false) => (
  <>
    <td className={`${NUM} ${bold ? "font-medium" : ""}`}>{s.dr ? money(s.dr) : ""}</td>
    <td className={`${NUM} ${bold ? "font-medium" : ""}`}>{s.cr ? money(s.cr) : ""}</td>
  </>
);

const DebitCredit = () => (
  <>
    <th className={th}>Debit</th>
    <th className={th}>Credit</th>
  </>
);

/** A heading that holds sub-accounts: one row with its total, and the accounts under it when it is open. */
function HeadingRows({ h, period, from, to, open, onToggle, first }: { h: TbHeading; period: boolean; from?: string; to: string; open: boolean; onToggle: () => void; first: boolean }) {
  const t = headingTotals(h.rows);
  return (
    <>
      <tr className={`transition-colors hover:bg-hover ${first ? "" : "border-t border-line"}`}>
        <td className="px-2.5 py-1 font-medium">
          <button type="button" aria-expanded={open} onClick={onToggle} className="inline-flex items-center gap-1.5 text-left font-medium text-ink hover:underline" title={open ? "Fold the accounts under it" : "Show the accounts under it"}>
            <span className="flex w-3.5 shrink-0 justify-center">
              <ChevronRight size={13} aria-hidden className={`text-ink-2 transition-transform ${open ? "rotate-90" : ""}`} />
            </span>
            {h.name}
          </button>
        </td>
        <td className="px-2.5 py-1 text-xs text-ink-2">{h.rows.length} {h.rows.length === 1 ? "account" : "accounts"}</td>
        {period && cells(t.opening, true)}
        {period && cells(t.movement, true)}
        {cells(t.closing, true)}
      </tr>
      {open &&
        h.rows.map((r) => (
          <tr key={r.accountId} className="transition-colors hover:bg-hover">
            <td className="px-2.5 py-1" />
            <td className="px-2.5 py-1 pl-6">
              <AccountLink accountId={r.accountId} from={from} to={to} className={r.sub ? undefined : "text-ink-3 hover:underline"}>
                {r.sub || h.name}
              </AccountLink>
            </td>
            {period && cells(r.opening)}
            {period && cells(r.movement)}
            {cells(r.closing)}
          </tr>
        ))}
    </>
  );
}

/**
 * The trial balance grouped by heading, Profit and Loss accounts first and then the Balance Sheet ones. A heading with sub-accounts folds: its row carries the
 * total and the accounts sit under it. Open to begin with, so what is printed or exported shows every account unless it was folded on screen.
 * `period` shows opening, movement and closing; without it, one Debit and Credit pair as at the date.
 */
export function TrialBalanceTable({ data, period, from, to }: { data: TrialBalanceByPeriod; period: boolean; from?: string; to: string }) {
  const cols = period ? 8 : 4;
  const foldable = data.sections.flatMap((s) => s.headings.filter((h) => !(h.rows.length === 1 && !h.rows[0].sub)).map((h) => h.key));
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allOpen = closed.size === 0;
  return (
    <>
      {foldable.length > 0 && (
        <div className="mb-1 flex justify-end print:hidden">
          <button type="button" className="text-xs font-medium text-accent-text hover:underline" onClick={() => setClosed(allOpen ? new Set(foldable) : new Set())}>
            {allOpen ? "Collapse all headings" : "Expand all headings"}
          </button>
        </div>
      )}
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
            ...s.headings.map((h, i) => {
              if (h.rows.length === 1 && !h.rows[0].sub) {
                // An account that is its own heading: nothing under it to fold.
                const r = h.rows[0];
                return (
                  <tr key={h.key} className={`transition-colors hover:bg-hover ${i === 0 ? "" : "border-t border-line"}`}>
                    <td className="px-2.5 py-1 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
                          <span className="h-1 w-1 rounded-full bg-ink-3" />
                        </span>
                        {h.name}
                      </span>
                    </td>
                    <td className="px-2.5 py-1">
                      <AccountLink accountId={r.accountId} from={from} to={to} className="text-ink-3 hover:underline">
                        {h.name}
                      </AccountLink>
                    </td>
                    {period && cells(r.opening)}
                    {period && cells(r.movement)}
                    {cells(r.closing)}
                  </tr>
                );
              }
              return <HeadingRows key={h.key} h={h} period={period} from={from} to={to} open={!closed.has(h.key)} onToggle={() => toggle(h.key)} first={i === 0} />;
            }),
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
    </>
  );
}
