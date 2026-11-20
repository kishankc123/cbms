"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getPaymentDetail, voidPayment } from "./actions";
import { getReconciledWarningAction } from "../suppliers/reconcile/status-actions";
import { PAYMENT_TYPE_LABELS } from "./payment-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useFormatDate, useFormatDateTime } from "@/components/calendar/calendar-provider";

type Detail = Awaited<ReturnType<typeof getPaymentDetail>>;
const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A payment's details as a centered pop-up, like an invoice, a bill or an expense: what it was for, the amount, the documents it settled, and the
 * buttons that apply. The accounting entry, the edit history and the audit trail are there too, folded away until opened. Voiding asks for its reason
 * inside the pop-up.
 */
export function PaymentDetailDrawer({ paymentId, onClose, onVoided, onEdit }: { paymentId: string; onClose: () => void; onVoided: () => void; onEdit: (detail: Detail) => void }) {
  const fmtDT = useFormatDateTime();
  const fmtDate = useFormatDate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  // Voiding a supplier payment inside a period already reconciled with them is allowed, with a word of warning.
  const [reconWarning, setReconWarning] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  useEffect(() => {
    if (!showVoid) return;
    let live = true;
    getReconciledWarningAction({ kind: "payment", id: paymentId })
      .then((w) => live && setReconWarning(w))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [showVoid, paymentId]);

  useEffect(() => {
    let cancelled = false;
    getPaymentDetail(paymentId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Failed to load payment"));
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  async function handleVoid() {
    if (!voidReason.trim()) {
      setVoidError("A reason is required.");
      return;
    }
    setVoiding(true);
    setVoidError(null);
    try {
      await voidPayment(paymentId, voidReason.trim());
      onVoided();
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : "Failed to void payment");
    } finally {
      setVoiding(false);
    }
  }

  const canVoid = detail && detail.origin === "standalone" && detail.status === "posted";
  return (
    <Modal
      size="md"
      title={detail ? `Payment ${detail.paymentNumber}` : "Payment"}
      description={detail ? `${detail.party || "No party"} · ${PAYMENT_TYPE_LABELS[detail.paymentType] ?? detail.paymentType}` : undefined}
      onClose={onClose}
      dismissible={!voiding}
      footer={
        detail && !showVoid ? (
          <>
            {detail.canEdit && (
              <Button variant="secondary" onClick={() => onEdit(detail)}>
                Edit
              </Button>
            )}
            {canVoid && (
              <Button variant="secondary" className="!text-[var(--danger-text)]" onClick={() => setShowVoid(true)}>
                Void
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </>
        ) : undefined
      }
    >
      {loadError && <p className="text-sm text-[var(--danger-text)]">{loadError}</p>}
      {!detail && !loadError && <p className="text-sm text-ink-2">Loading...</p>}

      {detail && (
        <div className="space-y-4 text-[13px] text-ink">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={detail.status === "voided" ? "critical" : detail.status === "draft" ? "pending" : "success"}>{detail.status === "posted" ? "Posted" : detail.status}</StatusPill>
            <StatusPill tone={detail.reconciliationStatus === "reconciled" ? "success" : "pending"}>{detail.reconciliationStatus === "reconciled" ? "Reconciled" : "Not reconciled"}</StatusPill>
            <span className="text-ink-2">{detail.direction === "money_in" ? "Money in" : "Money out"}</span>
          </div>

          <dl className="space-y-1 rounded-lg bg-surface-2 p-3">
            <Row label="Amount" value={<span className="text-[15px] font-medium">{fmt(detail.amount)}</span>} />
            <Row label="Date" value={fmtDate(detail.paymentDate)} />
            <Row label={detail.direction === "money_in" ? "Paid into" : "Paid from"} value={`${detail.paymentModeName ?? detail.paymentMethod.replace("_", " ")} · ${detail.accountName}`} />
            {detail.transferToAccountName && <Row label="To account" value={detail.transferToAccountName} />}
            {(detail.referenceNumber || detail.chequeNumber) && <Row label="Reference" value={[detail.referenceNumber, detail.chequeNumber ? `Cheque ${detail.chequeNumber}` : ""].filter(Boolean).join(" · ")} />}
            {detail.description && <Row label="Note" value={detail.description} />}
          </dl>

          {detail.allocations.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Settled</h3>
              <table className="w-full border-collapse text-xs">
                <thead className="text-ink-2">
                  <tr className="border-b border-line">
                    <th className="py-1 text-left font-medium">Document</th>
                    <th className="py-1 text-right font-medium">Applied</th>
                    <th className="py-1 text-right font-medium">Still owed</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.allocations.map((a, i) => (
                    <tr key={i}>
                      <td className="py-1">{a.label}</td>
                      <td className="py-1 text-right tabular-nums">{fmt(a.allocatedAmount)}</td>
                      <td className="py-1 text-right tabular-nums">{a.outstandingAfter !== null ? fmt(a.outstandingAfter) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="border-b border-line">
            <Fold title="Accounting entry">
              <table className="w-full border-collapse text-xs">
                <thead className="text-ink-2">
                  <tr className="border-b border-line">
                    <th className="py-1 text-left font-medium">Account</th>
                    <th className="py-1 text-right font-medium">Debit</th>
                    <th className="py-1 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.journalLines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1">{l.accountName}</td>
                      <td className="py-1 text-right tabular-nums">{l.debit > 0 ? fmt(l.debit) : ""}</td>
                      <td className="py-1 text-right tabular-nums">{l.credit > 0 ? fmt(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fold>

            {(detail.notes || detail.attachmentUrl) && (
              <Fold title="Notes and attachment">
                {detail.notes && <p className="text-ink-2">{detail.notes}</p>}
                {detail.attachmentUrl && (
                  <a href={detail.attachmentUrl} target="_blank" rel="noreferrer" className="break-all text-accent-text hover:underline">
                    {detail.attachmentUrl}
                  </a>
                )}
              </Fold>
            )}

            {detail.history.length > 0 && (
              <Fold title="Edit history" count={detail.history.length}>
                <div className="space-y-2">
                  {detail.history.map((h) => (
                    <div key={h.id} className="rounded-lg border border-line p-2.5">
                      <p className="text-xs text-ink-2">
                        Edited by {h.userName} on {fmtDT(h.at)}
                      </p>
                      <table className="mt-1 w-full border-collapse text-xs">
                        <thead className="text-ink-2">
                          <tr className="border-b border-line">
                            <th className="py-0.5 pr-2 text-left font-medium">Field</th>
                            <th className="py-0.5 pr-2 text-left font-medium">Was</th>
                            <th className="py-0.5 text-left font-medium">Now</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.changes.map((c) => (
                            <tr key={c.field} className="align-top">
                              <td className="py-0.5 pr-2 text-ink-2">{c.field}</td>
                              <td className="break-words py-0.5 pr-2 text-ink-2">{c.before}</td>
                              <td className="break-words py-0.5">{c.after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </Fold>
            )}

            <Fold title="Audit trail">
              <dl className="space-y-0.5">
                <Row label="Created" value={fmtDT(detail.createdAt)} />
                {detail.postedAt && <Row label="Posted" value={fmtDT(detail.postedAt)} />}
                {detail.updatedAt && <Row label="Last edited" value={fmtDT(detail.updatedAt)} />}
                {detail.voidedAt && <Row label="Voided" value={`${fmtDT(detail.voidedAt)}${detail.voidReason ? `: ${detail.voidReason}` : ""}`} />}
              </dl>
            </Fold>
          </div>

          {detail.origin === "embedded" && detail.status !== "voided" && <p className="text-xs text-ink-2">This payment was recorded automatically when the invoice or bill was created. Void or edit that invoice or bill to change it.</p>}

          {showVoid && (
            <div className="space-y-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3">
              <p className="font-medium text-[var(--danger-text)]">Void this payment?</p>
              <p className="text-xs text-ink-2">This reverses its entry and takes back what it settled on the invoices, bills or expenses.</p>
              {reconWarning && <p className="text-xs text-[var(--warning-text)]">{reconWarning}</p>}
              <Input
                value={voidReason}
                onChange={(e) => {
                  setVoidReason(e.target.value);
                  setVoidError(null);
                }}
                placeholder="Reason (required)"
                aria-label="Reason for voiding"
              />
              {voidError && <p className="text-xs text-[var(--danger-text)]">{voidError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowVoid(false)} disabled={voiding}>
                  Keep it
                </Button>
                <Button variant="secondary" className="!text-[var(--danger-text)]" onClick={handleVoid} loading={voiding}>
                  Void payment
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

// A section that stays closed until it is opened, so the pop-up stays short.
function Fold({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-9 w-full items-center justify-between text-left text-[13px] text-ink">
        <span>
          {title}
          {count ? <span className="text-ink-2"> ({count})</span> : null}
        </span>
        <ChevronDown size={15} className={`text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div className="pb-2.5">{children}</div>}
    </div>
  );
}
