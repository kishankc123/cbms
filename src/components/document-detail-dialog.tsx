"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { Amount } from "@/components/ui/data-table";
import type { DocumentDetailView } from "@/lib/ledger/document-detail";

export type DetailAction = { label: string; onClick: () => void; primary?: boolean; danger?: boolean; hidden?: boolean };

/**
 * The details of an invoice or a bill, opened by a double-tap, a double-click or a swipe on its row: who, when, the amounts, the items and the payments,
 * with the actions that apply to it along the bottom. The actions are the screen's own, so permissions, locks and warnings are exactly what they are
 * from the row's menu.
 */
export function DocumentDetailDialog({ detail, badge, actions, onClose }: { detail: DocumentDetailView; badge: { tone: StatusTone; label: string }; actions: DetailAction[]; onClose: () => void }) {
  const shown = actions.filter((a) => !a.hidden);
  return (
    <Modal
      title={`${detail.kind === "sale" ? "Invoice" : detail.kind === "purchase" ? "Bill" : "Expense"} ${detail.number}`}
      description={`${detail.partyName || "No name"} · ${detail.kind === "expense" && detail.category ? `${detail.category} · ` : ""}${detail.typeLabel}`}
      onClose={onClose}
      footer={
        shown.length > 0 ? (
          <>
            {shown.map((a) => (
              <Button key={a.label} variant={a.primary ? "primary" : "secondary"} onClick={a.onClick} className={a.danger ? "!text-[var(--danger-text)]" : ""}>
                {a.label}
              </Button>
            ))}
          </>
        ) : undefined
      }
    >
      <div className="space-y-4 text-[13px] text-ink">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
          <span className="text-ink-2">
            Dated <D value={detail.date} />
          </span>
          {detail.dueDate && (
            <span className="text-ink-2">
              Due <D value={detail.dueDate} />
            </span>
          )}
          {detail.detailsPending && <StatusPill tone="pending">Item details pending</StatusPill>}
        </div>

        {detail.description && <p className="text-ink-2">{detail.description}</p>}

        <div className="space-y-1 rounded-lg bg-surface-2 p-3">
          <Row label="Taxable" value={<Amount value={detail.taxable} />} />
          <Row label="VAT" value={<Amount value={detail.vat} />} />
          {(detail.otherTax ?? 0) > 0 && <Row label="Other tax" value={<Amount value={detail.otherTax ?? 0} />} />}
          <Row label="Total" value={<Amount value={detail.total} />} strong />
          {(detail.tds ?? 0) > 0 && <Row label="TDS withheld" value={<span>-<Amount value={detail.tds ?? 0} /></span>} />}
          {(detail.tds ?? 0) > 0 && <Row label="Payable" value={<Amount value={detail.payable ?? 0} />} strong />}
          <Row label={detail.kind === "sale" ? "Received" : "Paid"} value={<Amount value={detail.paid} />} />
          <Row label="Balance" value={<span className={detail.balance > 0.005 ? "text-[var(--danger-text)]" : "text-[var(--success-text)]"}><Amount value={detail.balance} /></span>} strong />
        </div>

        {detail.lines.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Items</h3>
            {detail.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 py-0.5">
                <span className="min-w-0 truncate">
                  {l.name} <span className="text-ink-2">× {l.quantity}</span>
                </span>
                <span className="tabular-nums">
                  <Amount value={l.amount} />
                </span>
              </div>
            ))}
          </section>
        )}

        {detail.payments.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">{detail.kind === "sale" ? "Payments received" : "Payments made"}</h3>
            {detail.payments.map((p, i) => (
              <div key={i} className="flex justify-between gap-3 py-0.5">
                <span>
                  <D value={p.date} /> <span className="text-ink-2">· {p.mode}</span>
                </span>
                <span className="tabular-nums">
                  <Amount value={p.amount} />
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-medium" : ""}`}>
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
