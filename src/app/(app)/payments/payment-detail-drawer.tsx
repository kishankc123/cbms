"use client";

import { useEffect, useState } from "react";
import { getPaymentDetail, voidPayment } from "./actions";
import { PAYMENT_TYPE_LABELS } from "./payment-types";
import { StatusPill } from "@/components/ui/status-pill";

type Detail = Awaited<ReturnType<typeof getPaymentDetail>>;
const fmt = (n: number) => n.toFixed(2);

export function PaymentDetailDrawer({ paymentId, onClose, onVoided }: { paymentId: string; onClose: () => void; onVoided: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPaymentDetail(paymentId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Failed to load payment"));
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !showVoid) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showVoid]);

  async function handleVoid() {
    if (!voidReason.trim()) {
      setVoidError("A void reason is required.");
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-lg space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Payment Detail</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!detail && !loadError && <p className="text-sm text-gray-500">Loading...</p>}

        {detail && (
          <>
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{detail.paymentNumber}</h3>
                <div className="flex gap-2">
                  <StatusPill tone={detail.status === "voided" ? "critical" : detail.status === "draft" ? "pending" : "success"}>{detail.status}</StatusPill>
                  <StatusPill tone={detail.reconciliationStatus === "reconciled" ? "success" : "pending"}>{detail.reconciliationStatus}</StatusPill>
                </div>
              </div>
              <DetailGrid
                rows={[
                  ["Date", detail.paymentDate],
                  ["Direction", detail.direction === "money_in" ? "Money In" : "Money Out"],
                  ["Type", PAYMENT_TYPE_LABELS[detail.paymentType] ?? detail.paymentType],
                  ["Party", detail.party],
                  ["Payment Method", detail.paymentMethod.replace("_", " ")],
                  ["Account", detail.accountName],
                  ...(detail.transferToAccountName ? [["To Account", detail.transferToAccountName] as [string, string]] : []),
                  ["Reference", detail.referenceNumber ?? "—"],
                  ...(detail.chequeNumber ? [["Cheque No.", detail.chequeNumber] as [string, string]] : []),
                  ["Amount", fmt(detail.amount)],
                  ["Description", detail.description ?? "—"],
                ]}
              />
            </section>

            {detail.allocations.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Allocation</h3>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5 text-xs">Target</th>
                        <th className="px-2 py-1.5 text-xs text-right">Allocated</th>
                        <th className="px-2 py-1.5 text-xs text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.allocations.map((a, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1 font-mono text-xs">{a.label}</td>
                          <td className="px-2 py-1 text-right">{fmt(a.allocatedAmount)}</td>
                          <td className="px-2 py-1 text-right">{a.outstandingAfter !== null ? fmt(a.outstandingAfter) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Accounting Entry</h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 text-xs">Account</th>
                      <th className="px-2 py-1.5 text-xs text-right">Debit</th>
                      <th className="px-2 py-1.5 text-xs text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.journalLines.map((l, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1">{l.accountName}</td>
                        <td className="px-2 py-1 text-right">{l.debit > 0 ? fmt(l.debit) : ""}</td>
                        <td className="px-2 py-1 text-right">{l.credit > 0 ? fmt(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {detail.notes && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900">Internal Notes</h3>
                <p className="text-sm text-gray-600">{detail.notes}</p>
              </section>
            )}
            {detail.attachmentUrl && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900">Attachments</h3>
                <a href={detail.attachmentUrl} target="_blank" rel="noreferrer" className="text-sm text-[var(--color-primary)] hover:underline break-all">
                  {detail.attachmentUrl}
                </a>
              </section>
            )}

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-gray-900">Audit Trail</h3>
              <DetailGrid
                rows={[
                  ["Created", new Date(detail.createdAt).toLocaleString()],
                  ...(detail.postedAt ? [["Posted", new Date(detail.postedAt).toLocaleString()] as [string, string]] : []),
                  ...(detail.voidedAt ? [["Voided", `${new Date(detail.voidedAt).toLocaleString()} — ${detail.voidReason ?? ""}`] as [string, string]] : []),
                ]}
              />
            </section>

            {detail.origin === "embedded" && detail.status !== "voided" && (
              <p className="text-xs text-gray-500">
                This payment was recorded automatically when the invoice/bill was created. Void or edit the source invoice/bill to change it.
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              {detail.origin === "standalone" && detail.status === "posted" && (
                <button type="button" onClick={() => setShowVoid(true)} className="rounded border border-red-300 text-red-600 hover:bg-red-50 text-sm px-4 py-1.5">
                  Void
                </button>
              )}
              <button type="button" onClick={onClose} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">
                Close
              </button>
            </div>

            {showVoid && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center">
                <div className="absolute inset-0 bg-black/30" onClick={() => setShowVoid(false)} />
                <div className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-lg space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">Void payment {detail.paymentNumber}</h3>
                  <p className="text-xs text-gray-500">This reverses its journal entry and rolls back any invoice/bill/expense allocation it made.</p>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Reason</label>
                    <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                  {voidError && <p className="text-xs text-red-600">{voidError}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setShowVoid(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                      Cancel
                    </button>
                    <button type="button" onClick={handleVoid} disabled={voiding} className="rounded bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-1.5 disabled:opacity-50">
                      {voiding ? "Voiding..." : "Void Payment"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <span className="text-gray-500">{label}</span>
          <span className="text-gray-900">{value}</span>
        </div>
      ))}
    </div>
  );
}
