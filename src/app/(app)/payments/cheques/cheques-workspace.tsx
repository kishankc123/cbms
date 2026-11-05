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
import { VIEW_LABEL, summarize, viewOf, type ChequeView } from "@/lib/cheques/cheque-rules";
import type { ChequeListRow } from "@/lib/cheques/cheques";
import { IssueChequeModal } from "./issue-cheque-modal";
import { ClearChequeModal, CloseChequeModal } from "./cheque-dialogs";

const TONE: Record<ChequeView, StatusTone> = { post_dated: "pending", due: "action", stale: "critical", cleared: "success", bounced: "critical", stopped: "neutral" };

type Filter = "outstanding" | "due" | "post_dated" | "cleared" | "closed" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "outstanding", label: "Outstanding" },
  { key: "due", label: "Due now" },
  { key: "post_dated", label: "Post-dated" },
  { key: "cleared", label: "Cleared" },
  { key: "closed", label: "Bounced or stopped" },
  { key: "all", label: "All" },
];

const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Dialog = { kind: "issue"; replacing?: ChequeListRow } | { kind: "clear"; cheque: ChequeListRow } | { kind: "close"; cheque: ChequeListRow; how: "stopped" | "bounced" } | null;

export function ChequesWorkspace({ cheques, today, canCreate, canEdit, canVoid }: { cheques: ChequeListRow[]; today: string; canCreate: boolean; canEdit: boolean; canVoid: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [, start] = useTransition();

  const summary = useMemo(() => summarize(cheques, today), [cheques, today]);

  const shown = cheques.filter((c) => {
    const v = viewOf(c, today);
    switch (filter) {
      case "outstanding":
        return c.status === "issued";
      case "due":
        return v === "due" || v === "stale";
      case "post_dated":
        return v === "post_dated";
      case "cleared":
        return v === "cleared";
      case "closed":
        return v === "bounced" || v === "stopped";
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
        title="Issued cheques"
        description="Cheques you have written. A cheque changes your books only when it clears."
        primary={
          canCreate && (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog({ kind: "issue" })}>
              Issue a cheque
            </Button>
          )
        }
      />

      <StatStrip
        items={[
          { label: "Waiting to clear", value: money(summary.outstanding.amount), tone: "default" },
          { label: "Due now or this week", value: money(summary.thisWeek.amount), tone: summary.thisWeek.amount > 0 ? "warning" : "default" },
          { label: "More than 30 days away", value: money(summary.later.amount) },
          { label: "Stale (older than 6 months)", value: money(summary.stale.amount), tone: summary.stale.count > 0 ? "danger" : "default" },
        ]}
      />
      <p className="-mt-3 text-xs text-ink-2">
        {summary.outstanding.count} {summary.outstanding.count === 1 ? "cheque" : "cheques"} waiting to clear. They are not in your bank balance in the books yet, but the cash is already promised.
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
            <Th>Payee</Th>
            <Th>Bank</Th>
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
                {cheques.length === 0 ? "No cheques yet. Issue one to start the register." : "No cheques in this view."}
              </Td>
            </Tr>
          )}
          {shown.map((c) => {
            const v = viewOf(c, today);
            return (
              <Tr key={c.id} className="group">
                <Td className="font-mono text-xs">{c.chequeNumber}</Td>
                <Td>
                  {c.payeeName}
                  <span className="block text-xs text-ink-2">{c.payeeKind === "expense" ? "Expense" : "Supplier bills"}</span>
                </Td>
                <Td className="text-ink-2">{c.bankName}</Td>
                <Td>
                  <D value={c.chequeDate} style="short" />
                </Td>
                <Td numeric>
                  <Amount value={c.amount} />
                </Td>
                <Td>
                  <StatusPill tone={TONE[v]}>{VIEW_LABEL[v]}</StatusPill>
                  {v === "cleared" && c.clearedDate && (
                    <span className="mt-0.5 block text-xs text-ink-2">
                      on <D value={c.clearedDate} style="short" />
                    </span>
                  )}
                  {(v === "bounced" || v === "stopped") && c.closedReason && <span className="mt-0.5 block max-w-[14rem] truncate text-xs text-ink-2">{c.closedReason}</span>}
                  {v === "stale" && <span className="mt-0.5 block text-xs text-[var(--danger-text)]">The bank may refuse it</span>}
                </Td>
                <Td align="right">
                  <RowActions>
                    {c.status === "issued" && canCreate && (
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "clear", cheque: c })}>
                        Mark cleared
                      </Button>
                    )}
                    {c.status === "issued" && canEdit && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "close", cheque: c, how: "stopped" })}>
                          Stop
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "close", cheque: c, how: "bounced" })}>
                          Bounced
                        </Button>
                      </>
                    )}
                    {c.status === "cleared" && canEdit && canVoid && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "close", cheque: c, how: "bounced" })}>
                        Returned by bank
                      </Button>
                    )}
                    {(c.status === "bounced" || c.status === "stopped") && canCreate && (
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "issue", replacing: c })}>
                        Re-issue
                      </Button>
                    )}
                  </RowActions>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </DataTable>

      {dialog?.kind === "issue" && <IssueChequeModal replacing={dialog.replacing ?? null} today={today} onClose={() => setDialog(null)} onSaved={() => done("Cheque written into the register")} />}
      {dialog?.kind === "clear" && <ClearChequeModal cheque={dialog.cheque} today={today} onClose={() => setDialog(null)} onDone={() => done("Cheque marked as cleared and the payment recorded")} />}
      {dialog?.kind === "close" && <CloseChequeModal cheque={dialog.cheque} how={dialog.how} onClose={() => setDialog(null)} onDone={() => done(dialog.how === "stopped" ? "Cheque stopped" : "Cheque marked as bounced")} />}
    </div>
  );
}
