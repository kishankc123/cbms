"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, RefreshCw } from "lucide-react";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import type { Line, Proof } from "@/lib/suppliers/reconcile-rules";
import { confirmMatchAction, deleteReconciliationAction, manualMatchAction, rematchAction, reopenAction, setFlagAction, signOffAction, unmatchAction } from "../actions";

type Group = { id: string; kind: string; status: "confirmed" | "suggested"; theirIds: string[]; ourIds: string[]; stale: boolean };
type Left = { id: string; date: string; reference: string; description: string; effect: number; reason: string; note: string };

const REASONS: [string, string][] = [
  ["timing", "Timing: the other side will catch up"],
  ["dispute", "Disputed"],
  ["our_error", "Our mistake, to correct"],
  ["their_error", "Their mistake, to raise"],
  ["other", "Other"],
];
const KIND_LABEL: Record<string, string> = { reference: "Same document number", reference_diff: "Same document number, different amount", amount_date: "Same amount, close dates", combination: "Several lines add up", manual: "Matched by hand" };

const th = "border-b border-line bg-app px-2.5 py-1.5 text-left text-xs font-medium text-ink-2";
const td = "border-b border-line px-2.5 py-1.5 align-top";

const signed = (n: number) => (n < 0 ? `(${Math.abs(n).toFixed(2)})` : n.toFixed(2));

export function ReconcileDetail(props: {
  reconId: string;
  vendorId: string;
  vendorName: string;
  from: string;
  to: string;
  status: string;
  notes: string;
  ourClosing: number;
  theirClosing: number;
  proof: Proof;
  bridge: { label: string; amount: number }[];
  theirs: Line[];
  ours: Line[];
  groups: Group[];
  theirsOnly: Left[];
  oursOnly: Left[];
  unresolved: number;
  suggested: number;
  stale: number;
  canEdit: boolean;
  canDelete: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const ask = useConfirm();
  const toast = useToast();
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);
  const [pickT, setPickT] = useState<Set<string>>(new Set());
  const [pickO, setPickO] = useState<Set<string>>(new Set());
  const [showMatched, setShowMatched] = useState(false);
  const signedOff = props.status === "reconciled";
  const editable = props.canEdit && !signedOff;
  const theirById = new Map(props.theirs.map((l) => [l.id, l]));
  const ourById = new Map(props.ours.map((l) => [l.id, l]));
  const suggested = props.groups.filter((g) => g.status === "suggested" && !g.stale);
  const matched = props.groups.filter((g) => g.status === "confirmed" && !g.stale);
  const stale = props.groups.filter((g) => g.stale);
  const matchedLines = matched.reduce((s, g) => s + g.theirIds.length, 0);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not save the change", null);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const pickedTheirs = props.theirsOnly.filter((l) => pickT.has(l.id)).reduce((s, l) => s + l.effect, 0);
  const pickedOurs = props.oursOnly.filter((l) => pickO.has(l.id)).reduce((s, l) => s + l.effect, 0);

  const groupRows = (g: Group) => (
    <div className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
      <div>
        <p className="text-xs text-ink-2">Their statement</p>
        {g.theirIds.map((id) => {
          const l = theirById.get(id);
          return l ? (
            <p key={id}>
              <D value={l.date} /> {l.reference} <span className="text-ink-2">{l.description}</span> <span className="tabular-nums">{signed(l.effect)}</span>
            </p>
          ) : null;
        })}
      </div>
      <div>
        <p className="text-xs text-ink-2">Your books</p>
        {g.ourIds.map((id) => {
          const l = ourById.get(id);
          return l ? (
            <p key={id}>
              <D value={l.date} /> {l.reference} <span className="text-ink-2">{l.description}</span> <span className="tabular-nums">{signed(l.effect)}</span>
            </p>
          ) : null;
        })}
      </div>
    </div>
  );

  const flagSelect = (l: Left, key: "theirLineId" | "entryId") => (
    <Select
      value={l.reason}
      disabled={!editable || busy}
      onChange={(e) => act(() => setFlagAction({ reconId: props.reconId, [key]: l.id, reason: (e.target.value || null) as never }))}
      className="h-7 w-52 text-xs"
    >
      <option value="">Choose a reason</option>
      {REASONS.map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-2">
          <D value={props.from} /> – <D value={props.to} /> {signedOff ? <StatusPill tone="success">Reconciled</StatusPill> : <StatusPill tone="pending">In progress</StatusPill>}
        </p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button icon={<Printer size={14} />} onClick={() => window.print()}>
            Print
          </Button>
          {editable && (
            <Button icon={<RefreshCw size={14} />} disabled={busy} onClick={() => act(() => rematchAction({ reconId: props.reconId }), "Matched again against your books.")}>
              Refresh from my books
            </Button>
          )}
          {props.canEdit && !signedOff && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                if (!(await ask("Sign this reconciliation off? Matches and reasons are locked until you reopen it.", { confirmLabel: "Sign off" }))) return;
                await act(() => signOffAction({ reconId: props.reconId }), "Signed off.");
              }}
            >
              Sign off
            </Button>
          )}
          {props.canEdit && props.canReopen && signedOff && (
            <Button disabled={busy} onClick={() => act(() => reopenAction({ reconId: props.reconId }))}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-ink-2">Your books</p>
          <p className="text-lg font-medium tabular-nums">{props.ourClosing.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-ink-2">Their statement</p>
          <p className="text-lg font-medium tabular-nums">{props.theirClosing.toFixed(2)}</p>
        </div>
        <div className={`rounded-lg p-3 ${Math.abs(props.proof.difference) < 0.005 ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--warning-bg)] text-[var(--warning-text)]"}`}>
          <p className="text-xs">Difference</p>
          <p className="text-lg font-medium tabular-nums">{props.proof.difference.toFixed(2)}</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-ink-2">Matched</p>
          <p className="text-lg font-medium tabular-nums">
            {matchedLines} of {props.theirs.length}
          </p>
        </div>
      </div>
      <p className="text-xs text-ink-2">
        The difference is made of: {signed(props.proof.openingDifference)} at the start, {signed(props.proof.matchedDifference)} on matched lines that disagree, {signed(props.proof.oursOnly)} only in your books, less {signed(props.proof.theirsOnly)} only on their statement.
        {props.unresolved > 0 && ` ${props.unresolved} leftover${props.unresolved === 1 ? " has" : "s have"} no reason yet.`}
      </p>

      {props.stale > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {props.stale} match{props.stale === 1 ? "" : "es"} point to something in your books that was voided or edited since. Press Refresh from my books to look at {props.stale === 1 ? "it" : "them"} again.
        </p>
      )}

      {suggested.length > 0 && (
        <section className="rounded-lg border border-line">
          <div className="border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-semibold text-ink">Suggested matches · {suggested.length}</h2>
            <p className="text-xs text-ink-2">Check each one. A match you don&apos;t confirm stays a suggestion.</p>
          </div>
          <div className="divide-y divide-line">
            {suggested.map((g) => (
              <div key={g.id} className="space-y-1.5 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusPill tone="action">{KIND_LABEL[g.kind] ?? g.kind}</StatusPill>
                  {editable && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => confirmMatchAction({ reconId: props.reconId, matchId: g.id }))}>
                        Confirm
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => act(() => unmatchAction({ reconId: props.reconId, matchId: g.id }))}>
                        Not the same
                      </Button>
                    </div>
                  )}
                </div>
                {groupRows(g)}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Only on their statement · {props.theirsOnly.length}</h2>
            <p className="text-xs text-ink-2">You may be missing these in your books.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {props.theirsOnly.map((l) => (
                <tr key={l.id}>
                  {editable && (
                    <td className={`${td} w-8`}>
                      <input type="checkbox" aria-label="Select line" checked={pickT.has(l.id)} onChange={() => toggle(pickT, setPickT, l.id)} />
                    </td>
                  )}
                  <td className={td}><D value={l.date} /></td>
                  <td className={td}>{l.reference}</td>
                  <td className={`${td} text-ink-2`}>{l.description || (l.effect > 0 ? "Their bill to you" : "Payment or credit")}</td>
                  <td className={`${td} text-right tabular-nums`}>{signed(l.effect)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {l.effect > 0 ? (
                      <Link href="/purchases" target="_blank" className="mr-3 text-xs text-accent hover:underline">
                        Record this bill
                      </Link>
                    ) : (
                      <Link href="/payments/money-out" target="_blank" className="mr-3 text-xs text-accent hover:underline">
                        Record this payment
                      </Link>
                    )}
                    {flagSelect(l, "theirLineId")}
                  </td>
                </tr>
              ))}
              {props.theirsOnly.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-center text-ink-3">Everything on their statement is matched.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line">
        <div className="border-b border-line px-3 py-2">
          <h2 className="text-[13px] font-semibold text-ink">Only in your books · {props.oursOnly.length}</h2>
          <p className="text-xs text-ink-2">They may not have these yet, or have recorded them differently.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {props.oursOnly.map((l) => (
                <tr key={l.id}>
                  {editable && (
                    <td className={`${td} w-8`}>
                      <input type="checkbox" aria-label="Select entry" checked={pickO.has(l.id)} onChange={() => toggle(pickO, setPickO, l.id)} />
                    </td>
                  )}
                  <td className={td}><D value={l.date} /></td>
                  <td className={td}>{l.reference}</td>
                  <td className={`${td} text-ink-2`}>{l.description}</td>
                  <td className={`${td} text-right tabular-nums`}>{signed(l.effect)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{flagSelect(l, "entryId")}</td>
                </tr>
              ))}
              {props.oursOnly.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-center text-ink-3">Everything in your books for this period is matched.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editable && (pickT.size > 0 || pickO.size > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 print:hidden">
          <p className="text-[13px] text-ink-2">
            Picked: {pickT.size} from their statement ({signed(pickedTheirs)}) and {pickO.size} from your books ({signed(pickedOurs)}).
          </p>
          <Button
            variant="primary"
            disabled={busy || pickT.size === 0 || pickO.size === 0}
            onClick={() =>
              act(async () => {
                await manualMatchAction({ reconId: props.reconId, theirLineIds: [...pickT], entryIds: [...pickO] });
                setPickT(new Set());
                setPickO(new Set());
              })
            }
          >
            Match these together
          </Button>
        </div>
      )}

      <section className="rounded-lg border border-line">
        <button type="button" onClick={() => setShowMatched((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left">
          <h2 className="text-[13px] font-semibold text-ink">Matched · {matched.length}</h2>
          <span className="text-xs text-ink-2">{showMatched ? "Hide" : "Show"}</span>
        </button>
        {showMatched && (
          <div className="divide-y divide-line border-t border-line">
            {matched.map((g) => (
              <div key={g.id} className="space-y-1.5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill tone="success">{KIND_LABEL[g.kind] ?? g.kind}</StatusPill>
                  {editable && (
                    <button type="button" disabled={busy} onClick={() => act(() => unmatchAction({ reconId: props.reconId, matchId: g.id }))} className="text-xs text-red-600 hover:underline">
                      Undo
                    </button>
                  )}
                </div>
                {groupRows(g)}
              </div>
            ))}
            {matched.length === 0 && <p className="px-3 py-3 text-[13px] text-ink-3">Nothing matched yet.</p>}
          </div>
        )}
        {stale.length > 0 && showMatched && <p className="px-3 pb-2 text-xs text-ink-2">{stale.length} earlier match{stale.length === 1 ? " is" : "es are"} not shown because the books changed.</p>}
      </section>

      <section className="rounded-lg border border-line p-4">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Reconciliation statement</h2>
        <table className="w-full max-w-lg border-collapse text-[13px]">
          <tbody>
            <tr>
              <td className="py-1 font-medium">Balance in your books at <D value={props.to} /></td>
              <td className="py-1 text-right font-medium tabular-nums">{props.ourClosing.toFixed(2)}</td>
            </tr>
            {props.bridge.map((r, i) => (
              <tr key={r.label} className={i === props.bridge.length - 1 ? "border-t border-line-strong font-medium" : "text-ink-2"}>
                <td className="py-1">{i === props.bridge.length - 1 ? r.label : `${r.amount < 0 ? "Less" : "Add"}: ${r.label.toLowerCase()}`}</td>
                <td className="py-1 text-right tabular-nums">{signed(r.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 text-ink-2">Their statement says</td>
              <td className="py-1 text-right tabular-nums">{props.theirClosing.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        {props.notes && <p className="mt-2 text-xs text-ink-2">{props.notes}</p>}
      </section>

      {props.canDelete && (
        <div className="flex justify-end print:hidden">
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!(await ask(`Delete this reconciliation with ${props.vendorName}? The matches and reasons are lost. Your books are not touched.`, { confirmLabel: "Delete", danger: true }))) return;
              await act(async () => {
                await deleteReconciliationAction({ reconId: props.reconId });
                router.push("/suppliers/reconcile");
              });
            }}
          >
            Delete reconciliation
          </Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
