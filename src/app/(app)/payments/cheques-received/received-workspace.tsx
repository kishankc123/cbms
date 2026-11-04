"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { D } from "@/components/calendar/date-text";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Amount, DataTable, RowActions, Td, Th, Tr } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { RECEIVED_LABEL, receivedViewOf, summarizeReceived, type ReceivedView } from "@/lib/cheques/received-rules";
import type { ReceivedListRow } from "@/lib/cheques/received";
import { CloseReceivedModal, ClearReceivedModal, DepositModal, ReceiveChequeModal } from "./received-dialogs";

const TONE: Record<ReceivedView, StatusTone> = { post_dated: "pending", ready: "action", deposited: "pending", stale: "critical", cleared: "success", bounced: "critical", returned: "neutral" };

type Filter = "waiting" | "ready" | "post_dated" | "deposited" | "cleared" | "closed" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "waiting", label: "Waiting" },
  { key: "ready", label: "Ready to deposit" },
  { key: "post_dated", label: "Post-dated" },
  { key: "deposited", label: "At the bank" },
  { key: "cleared", label: "Cleared" },
  { key: "closed", label: "Bounced or returned" },
  { key: "all", label: "All" },
];

const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Dialog = { kind: "receive" } | { kind: "deposit"; cheque: ReceivedListRow } | { kind: "clear"; cheque: ReceivedListRow } | { kind: "close"; cheque: ReceivedListRow; how: "bounced" | "returned" } | null;

export function ReceivedWorkspace({ cheques, today, canCreate, canEdit, canVoid }: { cheques: ReceivedListRow[]; today: string; canCreate: boolean; canEdit: boolean; canVoid: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("waiting");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [, start] = useTransition();

  const summary = useMemo(() => summarizeReceived(cheques, today), [cheques, today]);

  const shown = cheques.filter((c) => {
    const v = receivedViewOf(c, today);
    switch (filter) {
      case "waiting":
        return c.status === "received" || c.status === "deposited";
      case "ready":
        return v === "ready" || v === "stale";
      case "post_dated":
        return v === "post_dated";
      case "deposited":
        return v === "deposited";
      case "cleared":
        return v === "cleared";
      case "closed":
        return v === "bounced" || v === "returned";
      default:
        return true;
    }
  });

  function done(text: string) {
    setDialog(null);
    toast.success(text);
    start(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Received cheques"
        description="Cheques customers have given you. A cheque changes your books only when the bank clears it."
        primary={
          canCreate && (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog({ kind: "receive" })}>
              Receive a cheque
            </Button>
          )
        }
      />

      <StatStrip
        items={[
          { label: "Waiting to clear", value: money(summary.waiting.amount) },
          { label: "Ready to deposit", value: money(summary.readyToDeposit.amount), tone: summary.readyToDeposit.count > 0 ? "warning" : "default" },
          { label: "Post-dated, still to come", value: money(summary.postDated.amount) },
          { label: "At the bank", value: money(summary.deposited.amount) },
        ]}
      />
      <p className="-mt-3 text-xs text-ink-2">
        {summary.waiting.count} {summary.waiting.count === 1 ? "cheque" : "cheques"} not yet cleared. They are not in your books yet, but they are counted as money coming in on their dates in your cash forecast.
        {summary.stale.count > 0 ? ` ${summary.stale.count} ${summary.stale.count === 1 ? "is" : "are"} older than six months and the bank may refuse ${summary.stale.count === 1 ? "it" : "them"}.` : ""}
      </p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === f.key ? "border-accent bg-surface-2 font-medium text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink"}`}>
            {f.label}
          </button>
        ))}
      </div>

      <DataTable>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>Cheque</Th>
            <Th>From</Th>
            <Th>Drawn on</Th>
            <Th>Cheque date</Th>
            <Th align="right">Amount</Th>
            <Th>Status</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </Tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-ink-2">
                {cheques.length === 0 ? "No cheques yet. Record the first one you receive." : "No cheques in this view."}
              </Td>
            </Tr>
          )}
          {shown.map((c) => {
            const v = receivedViewOf(c, today);
            return (
              <Tr key={c.id} className="group">
                <Td className="font-mono text-xs">{c.chequeNumber}</Td>
                <Td>{c.payerName}</Td>
                <Td className="text-ink-2">{c.drawerBank}</Td>
                <Td>
                  <D value={c.chequeDate} style="short" />
                </Td>
                <Td numeric>
                  <Amount value={c.amount} />
                </Td>
                <Td>
                  <StatusPill tone={TONE[v]}>{RECEIVED_LABEL[v]}</StatusPill>
                  {v === "deposited" && c.depositBank && (
                    <span className="mt-0.5 block text-xs text-ink-2">
                      into {c.depositBank}
                      {c.depositedDate && (
                        <>
                          {" "}
                          on <D value={c.depositedDate} style="short" />
                        </>
                      )}
                    </span>
                  )}
                  {v === "cleared" && c.clearedDate && (
                    <span className="mt-0.5 block text-xs text-ink-2">
                      on <D value={c.clearedDate} style="short" />
                    </span>
                  )}
                  {(v === "bounced" || v === "returned") && c.closedReason && <span className="mt-0.5 block max-w-[14rem] truncate text-xs text-ink-2">{c.closedReason}</span>}
                  {v === "stale" && <span className="mt-0.5 block text-xs text-[var(--danger-text)]">The bank may refuse it</span>}
                </Td>
                <Td align="right">
                  <RowActions>
                    {c.status === "received" && (v === "ready" || v === "stale") && canCreate && (
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "deposit", cheque: c })}>
                        Deposit
                      </Button>
                    )}
                    {c.status === "deposited" && canCreate && (
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "clear", cheque: c })}>
                        Mark cleared
                      </Button>
                    )}
                    {c.status === "deposited" && canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "close", cheque: c, how: "bounced" })}>
                        Bounced
                      </Button>
                    )}
                    {c.status === "received" && canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "close", cheque: c, how: "returned" })}>
                        Give back
                      </Button>
                    )}
                    {c.status === "cleared" && canEdit && canVoid && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "close", cheque: c, how: "bounced" })}>
                        Returned by bank
                      </Button>
                    )}
                  </RowActions>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </DataTable>

      {dialog?.kind === "receive" && <ReceiveChequeModal today={today} onClose={() => setDialog(null)} onSaved={() => done("Cheque recorded in the register")} />}
      {dialog?.kind === "deposit" && <DepositModal cheque={dialog.cheque} today={today} onClose={() => setDialog(null)} onDone={() => done("Cheque marked as deposited")} />}
      {dialog?.kind === "clear" && <ClearReceivedModal cheque={dialog.cheque} today={today} onClose={() => setDialog(null)} onDone={() => done("Cheque marked as cleared and the receipt recorded")} />}
      {dialog?.kind === "close" && <CloseReceivedModal cheque={dialog.cheque} how={dialog.how} onClose={() => setDialog(null)} onDone={() => done(dialog.how === "returned" ? "Cheque given back" : "Cheque marked as bounced")} />}
    </div>
  );
}
