"use client";

import { useState } from "react";
import Link from "next/link";
import { D } from "@/components/calendar/date-text";
import { StatusPill } from "@/components/ui/status-pill";
import { useProblem } from "@/components/problem-dialog";
import type { SupplierReconStatus, StatementRow } from "@/lib/suppliers/reconcile-status";
import { getStatementRowsAction } from "../reconcile/status-actions";

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5 align-top";
const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => (n < 0 ? `(${money.format(Math.abs(n))})` : money.format(n));

// What has been reconciled with this supplier: how far, what has happened since, and each reconciliation with the statement they sent. Read-only: the
// matching itself is done on the reconciliation page.
export function ReconciliationPanel({ supplierId, status, canReconcile }: { supplierId: string; status: SupplierReconStatus; canReconcile: boolean }) {
  const { report, dialog } = useProblem();
  const [open, setOpen] = useState<string | null>(null);
  const [statement, setStatement] = useState<{ title: string; fileName: string; rows: StatementRow[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function showStatement(id: string) {
    if (open === id) {
      setOpen(null);
      setStatement(null);
      return;
    }
    setBusy(true);
    try {
      const s = await getStatementRowsAction({ reconId: id });
      setOpen(id);
      setStatement({ title: `${s.from} to ${s.to}`, fileName: s.fileName, rows: s.rows });
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not open the statement", null);
    } finally {
      setBusy(false);
    }
  }

  const openRow = status.rows.find((r) => r.id === open);

  return (
    <div className="space-y-4">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {status.through ? (
          <div className="rounded-lg bg-[var(--success-bg)] p-3 text-[var(--success-text)]">
            <p className="text-xs">Reconciled up to</p>
            <p className="text-lg font-medium">
              <D value={status.through} style="long" />
            </p>
            <p className="text-xs">{status.signedOffAt ? <>Signed off <D value={status.signedOffAt} style="long" /></> : "Signed off"}</p>
          </div>
        ) : (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-xs text-ink-2">Reconciled up to</p>
            <p className="text-lg font-medium text-ink">Not reconciled yet</p>
            {canReconcile && (
              <Link href={`/suppliers/reconcile?supplier=${supplierId}`} className="text-xs text-accent hover:underline">
                Upload their statement
              </Link>
            )}
          </div>
        )}

        {status.through && status.since && (
          <div className={`rounded-lg p-3 ${status.since.entries > 0 ? "bg-[var(--warning-bg)] text-[var(--warning-text)]" : "bg-surface-2"}`}>
            <p className="text-xs">Since then, in your books</p>
            <p className="text-lg font-medium">{status.since.entries === 0 ? "Nothing new" : `${status.since.entries} entr${status.since.entries === 1 ? "y" : "ies"} · ${fmt(status.since.movement)}`}</p>
            <p className="text-xs">{status.since.entries === 0 ? "The books agree with the last reconciliation." : "Not yet reconciled"}</p>
          </div>
        )}

        {status.inProgress && (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-xs text-ink-2">In progress</p>
            <p className="text-[15px] font-medium text-ink">
              <D value={status.inProgress.from} /> – <D value={status.inProgress.to} />
            </p>
            <Link href={`/suppliers/reconcile/${status.inProgress.id}`} className="text-xs text-accent hover:underline">
              Continue
            </Link>
          </div>
        )}
      </div>

      {status.gaps.length > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Not every period is reconciled. Not reconciled:{" "}
          {status.gaps.map((g, i) => (
            <span key={g.from}>
              {i > 0 && ", "}
              <D value={g.from} /> – <D value={g.to} />
            </span>
          ))}
          .
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Period</th>
              <th className={`${th} text-right`}>Our books</th>
              <th className={`${th} text-right`}>Their statement</th>
              <th className={`${th} text-right`}>Difference</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {status.rows.map((r) => (
              <tr key={r.id} className={`transition-colors hover:bg-hover ${open === r.id ? "bg-hover" : ""}`}>
                <td className={td}>
                  <D value={r.from} /> – <D value={r.to} />
                  <p className="text-xs text-ink-2">{r.fileName}</p>
                </td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.ourClosing)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.theirClosing)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.difference)}</td>
                <td className={td}>
                  {r.status === "reconciled" ? <StatusPill tone="success">Reconciled</StatusPill> : <StatusPill tone="pending">In progress</StatusPill>}
                  {r.signedOffAt && (
                    <p className="mt-0.5 text-xs text-ink-2">
                      <D value={r.signedOffAt} />
                    </p>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <button type="button" disabled={busy} onClick={() => showStatement(r.id)} className="mr-3 text-xs text-accent hover:underline">
                    {open === r.id ? "Hide statement" : "Their statement"}
                  </button>
                  <Link href={`/suppliers/reconcile/${r.id}`} className="text-xs text-accent hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {status.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                  Nothing reconciled with this supplier yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {statement && openRow && (
        <section className="rounded-lg border border-line p-3.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">
              Their statement · <D value={openRow.from} /> – <D value={openRow.to} />
            </h3>
            <p className="text-xs text-ink-2">{statement.fileName} · as uploaded, read-only</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Document no.</th>
                  <th className={th}>Particulars</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Against your books</th>
                </tr>
              </thead>
              <tbody>
                {statement.rows.map((r, i) => (
                  <tr key={i}>
                    <td className={td}><D value={r.date} /></td>
                    <td className={td}>{r.reference}</td>
                    <td className={`${td} text-ink-2`}>{r.description}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmt(r.effect)}</td>
                    <td className={td}>
                      <span className={r.state === "matched" ? "text-[var(--success-text)]" : r.state === "suggested" ? "text-accent" : "text-[var(--warning-text)]"}>
                        {r.state === "matched" ? "Matched" : r.state === "suggested" ? "Suggested" : "Left over"}
                      </span>
                      {r.against ? <span className="text-ink-2">, {r.against}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {dialog}
    </div>
  );
}
