"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { D } from "@/components/calendar/date-text";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { bucketOf, dueLabel, type DueBucket, type UpcomingItem, type UpcomingParty } from "@/lib/dashboard/upcoming-rules";
import { money } from "../cash-sections";
import { loadPartyDocuments } from "./actions";

const BUCKET_TONE: Record<DueBucket, StatusTone> = { overdue: "critical", today: "action", soon: "pending", scheduled: "neutral" };
const DOC_LABEL = { receivable: "Invoice", bill: "Bill", expense: "Expense" } as const;

// A party's ledger is where its balance is dealt with: the customer's or supplier's statement. A payee written on an expense has no ledger,
// so its documents link to the Expenses list.
const ledgerHref = (p: UpcomingParty) => (p.kind === "customer" ? `/reports/customer-statement?customer=${p.partyId}` : p.kind === "supplier" ? `/reports/supplier-statement?vendor=${p.partyId}` : "/expenses");

type Loaded = { items: UpcomingItem[]; hasMore: boolean } | "failed";

// One row per party. Its documents are fetched the first time the row is opened, not with the page, so a long list stays light.
export function PartyRows({ parties, today, side, bucket, empty }: { parties: UpcomingParty[]; today: string; side: "coming" | "going"; bucket: DueBucket | null; empty: string }) {
  const [docs, setDocs] = useState<Record<string, Loaded>>({});
  const [, start] = useTransition();

  if (parties.length === 0) return <p className="border-y border-line py-4 text-[13px] text-ink-2">{empty}</p>;

  function opened(p: UpcomingParty, open: boolean) {
    if (!open || docs[p.key]) return;
    start(async () => {
      try {
        const r = await loadPartyDocuments({ side, key: p.key, bucket });
        setDocs((d) => ({ ...d, [p.key]: r }));
      } catch {
        setDocs((d) => ({ ...d, [p.key]: "failed" }));
      }
    });
  }

  return (
    <ul className="divide-y divide-[var(--border)] border-y border-line">
      {parties.map((p) => {
        const b = bucketOf(p.earliestDue, today);
        const loaded = docs[p.key];
        return (
          <li key={p.key}>
            <details className="group" onToggle={(e) => opened(p, e.currentTarget.open)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
                <div className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight size={14} className="shrink-0 text-ink-2 transition-transform group-open:rotate-90" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{p.name}</p>
                    <p className="text-xs text-ink-2">
                      {p.count} {p.count === 1 ? "document" : "documents"}
                      {p.chequeCovered ? <span className="text-accent-text"> · {money(p.chequeCovered)} covered by cheques</span> : null}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tnum text-[13px] font-medium text-ink">{money(p.outstanding)}</span>
                  <StatusPill tone={BUCKET_TONE[b]}>{dueLabel(p.earliestDue, today)}</StatusPill>
                </div>
              </summary>
              <div className="mb-2 ml-5 rounded-md bg-surface-2 px-3 py-2">
                {loaded === undefined ? (
                  <p className="py-1 text-xs text-ink-2">Loading…</p>
                ) : loaded === "failed" ? (
                  <p className="py-1 text-xs text-[var(--danger-text)]">These could not be loaded. Close the row and open it again.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {loaded.items.map((i) => (
                      <li key={`${i.kind}-${i.id}`} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                        <span className="min-w-0 truncate text-ink-2">
                          {DOC_LABEL[i.kind]} {i.reference} · {i.hasDueDate ? "due" : "dated"} <D value={i.dueDate} style="short" />
                          {!i.hasDueDate && " (no due date set)"}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tnum text-ink">{money(i.outstanding)}</span>
                          <span className="w-24 text-right text-ink-2">{dueLabel(i.dueDate, today)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {typeof loaded === "object" && loaded.hasMore && <p className="pt-1 text-xs text-ink-2">Showing the first {loaded.items.length}. The ledger has the rest.</p>}
                <Link href={ledgerHref(p)} className="mt-1.5 inline-block text-xs font-medium text-accent-text hover:underline">
                  {p.kind === "payee" ? "Open Expenses →" : "Open ledger →"}
                </Link>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
