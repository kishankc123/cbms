"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import { ExportButtons } from "@/components/export-buttons";
import { EntryPopup } from "@/components/ledger/entry-popup";
import { ReportFooter, ReportHeader, ReportSheet } from "@/components/report-sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { entriesTotal, sortRows, type Bucket, type ControlCheck, type PartyRow, type PartyTotals } from "@/lib/ledger/party-balances-rules";
import { money } from "@/lib/ledger/pnl-compare-rules";

export type PartyConfig = {
  /** "Suppliers" / "Customers": the heading of the first column. */
  parties: string;
  party: string;
  labels: Record<Bucket, string>;
  /** The page that shows one party's full statement, and the name of its query parameter. */
  statement: { href: string; param: string };
  scope: "purchases" | "sales";
  control: string;
};
export type ReconMark = { state: "reconciled" | "in_progress" | "unreconciled"; through: string | null };

const th = "px-2 py-1.5 font-medium text-right";
const num = "px-2 py-1 text-right tabular-nums";
const BUCKETS: Bucket[] = ["inv", "pay", "ret", "other"];

/**
 * Trade payables or trade receivables: one row for each supplier or customer (opening, what moved, closing), and below it the entries behind the figures.
 * Click a party, or one of its figures, to see its entries; the entries are in the same table, so what is on the screen is what is printed and saved.
 */
export function PartyBalancesView({
  config,
  title,
  header,
  period,
  from,
  to,
  rows,
  totals,
  check,
  leftOut,
  recon,
  extraControls,
}: {
  config: PartyConfig;
  title: string;
  header: { company: string; address?: string };
  period: string;
  from: string;
  to: string;
  rows: PartyRow[];
  totals: PartyTotals;
  check: ControlCheck;
  leftOut: { label: string; closing: number } | null;
  recon: Record<string, ReconMark> | null;
  extraControls?: React.ReactNode;
}) {
  const [sort, setSort] = useState<"name" | "closing">("name");
  const [unreconciledOnly, setUnreconciledOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [mode, setMode] = useState<"selected" | "all">("selected");
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const shown = useMemo(() => sortRows(rows.filter((r) => !unreconciledOnly || (recon?.[r.id]?.state ?? "unreconciled") !== "reconciled"), sort), [rows, sort, unreconciledOnly, recon]);
  const shownTotals = useMemo(() => {
    if (!unreconciledOnly) return totals;
    const sum = (k: keyof PartyTotals) => Math.round(shown.reduce((s, r) => s + r[k], 0) * 100) / 100;
    return { opening: sum("opening"), inv: sum("inv"), pay: sum("pay"), ret: sum("ret"), other: sum("other"), closing: sum("closing") };
  }, [unreconciledOnly, totals, shown]);
  const hasStatus = recon !== null;
  const cols = 7 + (hasStatus ? 1 : 0);
  const blocks = mode === "all" ? shown.filter((r) => r.entries.length > 0 || r.opening !== 0) : shown.filter((r) => r.id === selected);
  const reconciledCount = recon ? rows.filter((r) => recon[r.id]?.state === "reconciled").length : 0;

  const pick = (id: string, b: Bucket | "all") => {
    setSelected(id);
    setBucket(b);
    setMode("selected");
  };

  const statusCell = (id: string) => {
    const s = recon?.[id];
    if (!s) return <td />;
    return (
      <td className="px-2 py-1 text-left">
        {s.state === "reconciled" && <StatusPill tone="success">Reconciled</StatusPill>}
        {s.state === "in_progress" && <StatusPill tone="pending">In progress</StatusPill>}
        {s.state === "unreconciled" && <StatusPill tone="neutral">Unreconciled</StatusPill>}
        {s.state === "unreconciled" && s.through && (
          <span className="ml-1.5 text-[11px] text-ink-3">
            last: <D value={s.through} />
          </span>
        )}
      </td>
    );
  };

  const entryBlock = (r: PartyRow) => {
    const list = bucket === "all" ? r.entries : r.entries.filter((e) => e.bucket === bucket);
    return (
      <Fragment key={r.id}>
        <tr>
          <td colSpan={cols} className="px-2 pb-0.5 pt-3 font-semibold">
            {r.name}
            {bucket !== "all" && <span className="font-normal text-ink-2">: {config.labels[bucket]}</span>}
            {r.hiddenPairs > 0 && <span className="ml-2 text-xs font-normal text-ink-3">{r.hiddenPairs === 1 ? "1 voided entry" : `${r.hiddenPairs} voided entries`} left out (they cancel)</span>}
            <Link href={`${config.statement.href}?${config.statement.param}=${r.id}&from=${from}&to=${to}`} className="ml-3 text-xs font-normal text-accent hover:underline print:hidden">
              Open full statement
            </Link>
          </td>
        </tr>
        {bucket === "all" && (
          <tr className="font-medium">
            <td colSpan={cols - 1} className="px-2 py-1">
              Opening balance, <D value={from} />
            </td>
            <td className={num}>{money(r.opening)}</td>
          </tr>
        )}
        {list.length === 0 && (
          <tr>
            <td colSpan={cols} className="px-2 py-1 text-ink-2">
              Nothing of this kind in the period.
            </td>
          </tr>
        )}
        {list.map((e, i) => (
          <tr key={`${e.entryId}:${i}`} onClick={() => e.entryId && setOpenEntry(e.entryId)} className={`transition-colors hover:bg-hover ${e.entryId ? "cursor-pointer" : ""}`} title={e.entryId ? "Click to see this transaction" : undefined}>
            <td className="px-2 py-1 pl-5">
              <D value={e.date} />
              {e.reference ? <span className="text-ink-2"> · {e.reference}</span> : null}
            </td>
            <td colSpan={cols - 3} className="px-2 py-1">
              {e.details}
              {e.isReversal && <span className="ml-2 text-xs text-ink-3">reversal</span>}
            </td>
            <td className={`${num} ${bucket === "all" ? "" : "font-medium"}`}>{money(e.amount)}</td>
            <td className={num}>{bucket === "all" ? money(e.balance) : ""}</td>
          </tr>
        ))}
        <tr className="border-t border-line font-medium">
          <td colSpan={cols - 2} className="px-2 py-1">
            {bucket === "all" ? (
              <>
                Closing balance, <D value={to} />
              </>
            ) : (
              `Total ${config.labels[bucket].toLowerCase()}`
            )}
          </td>
          <td className={num}>{bucket === "all" ? "" : money(entriesTotal(list))}</td>
          <td className={num}>{bucket === "all" ? money(r.closing) : ""}</td>
        </tr>
      </Fragment>
    );
  };

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`h-8 rounded-md border px-3 text-[13px] ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink hover:bg-hover"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 print:hidden">
        {extraControls}
        <span className="text-xs text-ink-2">Sort</span>
        {chip(sort === "name", "By name", () => setSort("name"))}
        {chip(sort === "closing", "Largest balance first", () => setSort("closing"))}
        {hasStatus && chip(unreconciledOnly, "Not reconciled only", () => setUnreconciledOnly((v) => !v))}
        <span className="ml-2 text-xs text-ink-2">Entries below</span>
        {chip(mode === "selected", `Selected ${config.party}`, () => setMode("selected"))}
        {chip(mode === "all", `Every ${config.party}`, () => setMode("all"))}
        <div className="ml-auto">
          <ExportButtons />
        </div>
      </div>

      <ReportSheet>
        <ReportHeader {...header} title={title} period={period} />
        {shown.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-2">Nothing to show for this period.</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-[13px]">
            <colgroup>
              <col style={{ width: hasStatus ? "22%" : "26%" }} />
              {BUCKETS.map((b) => (
                <col key={b} />
              ))}
              <col />
              <col />
              {hasStatus && <col style={{ width: "14%" }} />}
            </colgroup>
            <thead>
              <tr className="border-b border-line-strong">
                <th className="px-2 py-1.5 text-left font-medium">{config.parties}</th>
                <th className={th}>Opening</th>
                {BUCKETS.map((b) => (
                  <th key={b} className={th}>
                    {config.labels[b]}
                  </th>
                ))}
                <th className={th}>Closing</th>
                {hasStatus && <th className="px-2 py-1.5 text-left font-medium">Status</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`transition-colors hover:bg-hover ${selected === r.id && mode === "selected" ? "bg-accent-soft" : ""}`}>
                  <td className="cursor-pointer px-2 py-1" onClick={() => pick(r.id, "all")}>
                    {r.name}
                    {r.closing < 0 && <span className="ml-1.5 text-[11px] text-ink-3">Advance</span>}
                  </td>
                  <td className={`${num} cursor-pointer`} onClick={() => pick(r.id, "all")}>
                    {money(r.opening)}
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b} className={`${num} cursor-pointer`} onClick={() => pick(r.id, b)} title={`Show the ${config.labels[b].toLowerCase()} of ${r.name}`}>
                      {money(r[b])}
                    </td>
                  ))}
                  <td className={`${num} cursor-pointer font-medium`} onClick={() => pick(r.id, "all")}>
                    {money(r.closing)}
                  </td>
                  {hasStatus && statusCell(r.id)}
                </tr>
              ))}
              <tr className="border-t border-line-strong bg-hover font-semibold">
                <td className="px-2 py-1.5">Total</td>
                <td className={num}>{money(shownTotals.opening)}</td>
                {BUCKETS.map((b) => (
                  <td key={b} className={num}>
                    {money(shownTotals[b])}
                  </td>
                ))}
                <td className={num}>{money(shownTotals.closing)}</td>
                {hasStatus && (
                  <td className="px-2 py-1.5 text-left text-xs font-normal text-ink-2">
                    {reconciledCount} of {rows.length} reconciled
                  </td>
                )}
              </tr>
              {blocks.length > 0 && (
                <>
                  <tr aria-hidden>
                    <td colSpan={cols} className="h-4" />
                  </tr>
                  <tr className="border-b border-line-strong">
                    <td colSpan={cols} className="px-2 pb-1 text-[13px] font-semibold">
                      Entries behind the figures
                    </td>
                  </tr>
                  {blocks.map(entryBlock)}
                </>
              )}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
          <StatusPill tone={check.balanced ? "success" : "critical"}>
            {check.balanced ? `✓ Closing total agrees with ${config.control} in the ledger` : `⚠ ${config.control} in the ledger is ${money(check.ledger)}; the ${config.parties.toLowerCase()} add up to ${money(check.parties)}`}
          </StatusPill>
          {!check.balanced && <span className="text-xs text-ink-2">The difference of {money(check.difference)} was posted straight to {config.control}, not to a {config.party}.</span>}
          {leftOut && leftOut.closing !== 0 && (
            <span className="text-xs text-ink-2">
              {leftOut.label} is left out of the table (balance {money(leftOut.closing)}) but counted in the check.
            </span>
          )}
        </div>
        {!selected && mode === "selected" && shown.length > 0 && <p className="mt-2 text-xs text-ink-2 print:hidden">Click a {config.party}, or one of its figures, to see the entries behind it.</p>}
        <ReportFooter />
      </ReportSheet>
      {openEntry && <EntryPopup entryId={openEntry} scope={config.scope} onClose={() => setOpenEntry(null)} />}
    </div>
  );
}
