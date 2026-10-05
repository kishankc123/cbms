"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { InfoDialog } from "../../inventory/info-dialog";
import { previewDepreciation, reverseDepreciation, runDepreciation, type DepreciationPageData } from "../actions";
import { money } from "../shared";

type Preview = NonNullable<DepreciationPageData["preview"]>;
const card = "rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]";
const SHOWN = 100;

export function DepreciationView({ data }: { data: DepreciationPageData }) {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [anchor, setAnchor] = useState(data.months[0]?.anchor ?? "");
  const [preview, setPreview] = useState<Preview | null>(data.preview);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Fresh server data (after a run or a reversal) starts the picker over, without remounting and losing an open message.
  const [seen, setSeen] = useState(data);
  if (seen !== data) {
    setSeen(data);
    setAnchor(data.months[0]?.anchor ?? "");
    setPreview(data.preview);
  }
  const [reversing, setReversing] = useState<DepreciationPageData["runs"][number] | null>(null);

  async function choose(next: string) {
    setAnchor(next);
    setLoading(true);
    try {
      setPreview(await previewDepreciation(next));
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }

  async function post() {
    setConfirming(false);
    setPosting(true);
    try {
      const r = await runDepreciation(anchor);
      if (!r.ok) return report(r.error);
      setDone(`Depreciation of ${money(r.total)} was posted for ${r.assetCount} asset${r.assetCount === 1 ? "" : "s"}.`);
    } catch (e) {
      reportError(e);
    } finally {
      setPosting(false);
    }
  }

  async function reverse() {
    const run = reversing;
    setReversing(null);
    if (!run) return;
    try {
      const r = await reverseDepreciation(run.id);
      if (!r.ok) return report(r.error);
      router.refresh();
    } catch (e) {
      reportError(e);
    }
  }

  const canPost = data.canRun && preview && !preview.blocked && preview.lines.length > 0 && !loading && !posting;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Posted through" value={data.lastRunLabel ?? "Nothing posted yet"} />
        <Stat label="Total depreciation posted" value={money(data.summary.totalPosted)} />
        <Stat label="Assets being depreciated" value={String(data.summary.depreciatingAssets)} />
      </div>

      <section className={`${card} p-4`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Run depreciation</h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Months run in order. An asset behind on earlier months catches up in the run you post.</p>
          </div>
          {data.months.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Depreciate through</label>
              <select className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" value={anchor} onChange={(e) => choose(e.target.value)}>
                {data.months.map((m) => (
                  <option key={m.anchor} value={m.anchor}>
                    {m.label}
                  </option>
                ))}
              </select>
              {data.canRun && (
                <button type="button" disabled={!canPost} onClick={() => setConfirming(true)} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
                  {posting ? "Posting..." : "Post depreciation"}
                </button>
              )}
            </div>
          )}
        </div>

        {data.months.length === 0 ? (
          <p className="mt-4 rounded bg-[var(--surface-muted-bg)] p-4 text-sm text-[var(--text-secondary)]">
            {data.summary.depreciatingAssets === 0 ? "No asset is being depreciated yet. Add one under Purchase / Sell asset." : "Every month that has ended is already posted. The next month can be run once it is over."}
          </p>
        ) : preview?.blocked ? (
          <p className="mt-4 rounded bg-[var(--surface-muted-bg)] p-4 text-sm text-[var(--text-secondary)]">{preview.blocked}</p>
        ) : preview && preview.lines.length === 0 ? (
          <p className="mt-4 rounded bg-[var(--surface-muted-bg)] p-4 text-sm text-[var(--text-secondary)]">No asset has depreciation due through {preview.period.label}.</p>
        ) : preview ? (
          <div className={`mt-4 overflow-x-auto ${loading ? "opacity-50" : ""}`}>
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Asset</th>
                  <th className="px-4 py-2 text-right font-medium">Months</th>
                  <th className="px-4 py-2 text-right font-medium">Depreciation</th>
                  <th className="px-4 py-2 text-right font-medium">Accumulated after</th>
                  <th className="px-4 py-2 text-right font-medium">Net book value after</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.slice(0, SHOWN).map((l) => (
                  <tr key={l.assetId} className="border-t border-[var(--card-border)]">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/assets/${l.assetId}`} className="text-[var(--color-primary)] hover:underline">
                        {l.assetCode}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{l.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.months}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(l.amount)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(l.accumulatedAfter)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(l.netBookValueAfter)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--card-border)] font-semibold">
                  <td className="px-4 py-2" colSpan={3}>
                    Total ({preview.lines.length}){preview.lines.length > SHOWN ? ` — first ${SHOWN} shown` : ""}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(preview.total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </section>

      <section className={`${card} overflow-x-auto`}>
        <h2 className="px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">Previous runs</h2>
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-muted-bg)] text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Posted on</th>
              <th className="px-4 py-2 text-right font-medium">Assets</th>
              <th className="px-4 py-2 text-right font-medium">Depreciation</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className={`border-t border-[var(--card-border)] ${r.status === "reversed" ? "opacity-50" : ""}`}>
                <td className="px-4 py-2 font-medium">DEP-{String(r.runNumber).padStart(6, "0")}</td>
                <td className="px-4 py-2">{r.periodLabel}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  <D value={r.createdAt.slice(0, 10)} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.assetCount}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(r.totalAmount)}</td>
                <td className="px-4 py-2">
                  <StatusPill tone={r.status === "posted" ? "success" : "critical"}>{r.status === "posted" ? "Posted" : "Reversed"}</StatusPill>
                </td>
                <td className="px-4 py-2 text-right">
                  {data.canReverse && r.id === data.latestPostedId && (
                    <button type="button" onClick={() => setReversing(r)} className="text-sm text-red-600 hover:underline">
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.runs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  No depreciation has been run yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {confirming && preview && (
        <ConfirmDialog message={`Post depreciation of ${money(preview.total)} for ${preview.lines.length} asset${preview.lines.length === 1 ? "" : "s"} through ${preview.period.label}?`} onYes={post} onNo={() => setConfirming(false)} />
      )}
      {reversing && <ConfirmDialog message={`Reverse the depreciation run for ${reversing.periodLabel}? Its accounting entry is reversed and each asset gets those months back.`} onYes={reverse} onNo={() => setReversing(null)} />}
      {done && (
        <InfoDialog
          message={done}
          onOk={() => {
            setDone(null);
            router.refresh();
          }}
        />
      )}
      {dialog}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-xs text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
