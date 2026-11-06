"use client";

import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { TaxDepreciationSetupData } from "./actions";

type Ready = TaxDepreciationSetupData & { rules: NonNullable<TaxDepreciationSetupData["rules"]> };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const th = "border-b border-line bg-app py-1.5 pr-3 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line py-1.5 pr-3 align-top";
const STRONG = new Set(["base", "total", "closing", "balancing"]);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPanel({ data }: { data: Ready }) {
  const { schedule, compare, calc } = data;
  if (!schedule || !calc) return <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">{data.calcError ?? "Nothing to report for this tax year."}</p>;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Tax depreciation schedule, {calc.label}</h2>
            <p className="text-xs text-ink-2">
              {calc.final ? "Finalised" : "Preview, not finalised"} · {calc.rules.legalReference}
              {!calc.rulesVerified && " · rules not verified"}
            </p>
          </div>
          <Button size="sm" onClick={() => download(`tax-depreciation-schedule-${calc.label.replace("/", "-")}.csv`, data.scheduleCsv)} disabled={schedule.columns.length === 0}>Download for a spreadsheet</Button>
        </div>
        {schedule.columns.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">No class has anything in this tax year yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th} />
                  {schedule.columns.map((c) => <th key={c.key} className={`${th} min-w-32 text-right`}>{c.label}</th>)}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((r) => (
                  <tr key={r.key} className={STRONG.has(r.key) ? "font-semibold" : ""}>
                    <td className={`${td} text-ink-2`}>{r.label}</td>
                    {r.cells.map((v, i) => <td key={i} className={`${td} text-right tabular-nums`}>{v === null ? "" : r.kind === "rate" ? `${v}%` : money(v)}</td>)}
                    <td className={`${td} text-right tabular-nums`}>{r.total === null ? "" : money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {compare && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Your books beside the tax figures</h2>
          <p className="text-xs text-ink-2">For this tax year. The books are read only: nothing here changes them. This is the starting point for working from accounting profit to taxable profit.</p>
          <table className="w-full max-w-2xl text-sm">
            <thead><tr><th className={th} /><th className={`${th} text-right`}>Books</th><th className={`${th} text-right`}>Tax</th><th className={`${th} text-right`}>Difference</th></tr></thead>
            <tbody>
              <tr><td className={td}>Depreciation deducted</td><td className={`${td} text-right tabular-nums`}>{money(compare.bookDepreciation)}</td><td className={`${td} text-right tabular-nums`}>{money(compare.taxDeduction)}</td><td className={`${td} text-right tabular-nums`}>{money(compare.depreciationDifference)}</td></tr>
              <tr><td className={td}>Gain (+) or loss (−) on disposals</td><td className={`${td} text-right tabular-nums`}>{money(compare.bookDisposalGainLoss)}</td><td className={`${td} text-right tabular-nums`}>{money(compare.taxDisposalResult)}</td><td className={`${td} text-right tabular-nums`}>{money(compare.taxDisposalResult - compare.bookDisposalGainLoss)}</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-ink-2">Tax on disposals is the balancing charge less any terminal deduction. A positive difference on depreciation means tax allows more than the books charged.</p>
        </section>
      )}
    </div>
  );
}

const TAB_LABEL = { classes: "Asset classes", assets: "Asset tax details", calculation: "Calculation" } as const;

export function ReviewPanel({ data, go }: { data: Ready; go: (tab: "classes" | "assets" | "calculation") => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">Decisions that are waiting on a person. Until they are settled, treat the tax figures as provisional.</p>
      {data.review.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-2">Nothing needs a decision.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.review.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">{i.title}</p>
                <p className="mt-0.5 text-xs text-ink-2">{i.detail}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={i.kind === "period" ? "critical" : "action"}>{i.kind === "rules" ? "Rules" : i.kind === "period" ? "Missing" : "Review"}</StatusPill>
                <button type="button" onClick={() => go(i.tab)} className="text-xs text-accent-text hover:underline">Open {TAB_LABEL[i.tab]}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
