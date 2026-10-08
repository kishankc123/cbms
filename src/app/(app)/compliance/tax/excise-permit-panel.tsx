"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { todayIso } from "@/lib/calendar";
import { ConfirmDialog } from "../../sales/confirm-dialog";
import { getExcisePermit, recordExciseRenewal, saveExciseFee, undoExciseRenewal, type ExcisePermitView } from "../excise-actions";

const input = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none";
const money = (n: number) => `Rs ${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

// The excise permit: whether it is active, in its renewal window (Shrawan) or expired, what the late fine comes to, and the
// renewals paid. The fine is a share of the company's own standard renewal fee, by how late the renewal is.
export function ExcisePermitPanel() {
  const router = useRouter();
  const { report, reportError, dialog } = useProblem();
  const [view, setView] = useState<ExcisePermitView | null>(null);
  const [fee, setFee] = useState("");
  const [renewing, setRenewing] = useState<{ paidDate: string; fee: string; fine: string; receipt: string; notes: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);

  function apply(v: ExcisePermitView) {
    setView(v);
    setFee(v.permit?.standardFee != null ? String(v.permit.standardFee) : "");
  }
  async function load() {
    try {
      apply(await getExcisePermit());
    } catch (e) {
      reportError(e);
    }
  }
  useEffect(() => {
    let live = true;
    getExcisePermit()
      .then((v) => live && apply(v))
      .catch((e) => live && reportError(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!view) return <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading the excise permit...</div>;
  if (!view.permit) {
    return <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">Add the excise permit date (Effective from) in Company Details &gt; Registrations to track the permit and its yearly renewal here.</div>;
  }
  const { permit, canEdit } = view;
  const s = permit.status;
  const tone: StatusTone = s.state === "active" ? "success" : s.state === "renewal_window" ? "action" : "critical";
  const label = s.cancelled ? "Cancelled: no licence" : s.state === "active" ? "Active" : s.state === "renewal_window" ? "Renewal due" : "Expired: penalty mode";

  async function saveFee() {
    setBusy(true);
    try {
      const n = fee.trim() === "" ? null : Number(fee);
      const r = await saveExciseFee(n);
      if (!r.ok) return report(r.error);
      await load();
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  function startRenewal() {
    setRenewing({ paidDate: todayIso(), fee: permit.standardFee != null ? String(permit.standardFee) : "", fine: s.penalty?.fine != null ? String(s.penalty.fine) : "0", receipt: "", notes: "" });
  }

  async function submitRenewal() {
    if (!renewing) return;
    setBusy(true);
    try {
      const r = await recordExciseRenewal({ fiscalYearStart: s.unpaidYears[0], paidDate: renewing.paidDate, feeAmount: Number(renewing.fee), penaltyAmount: Number(renewing.fine || 0), receiptReference: renewing.receipt, notes: renewing.notes });
      if (!r.ok) return report(r.error);
      setRenewing(null);
      await load();
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setUndoing(false);
    setBusy(true);
    try {
      const r = await undoExciseRenewal();
      if (!r.ok) return report(r.error);
      await load();
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">Excise permit</h2>
          <StatusPill tone={tone}>{label}</StatusPill>
        </div>
        {canEdit && s.unpaidYears.length > 0 && (
          <button type="button" onClick={startRenewal} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
            Record renewal for FY {s.renewalFor.label}
          </button>
        )}
      </div>

      <p className={`text-sm ${s.state === "expired" ? "text-[var(--status-critical-text)]" : "text-gray-700"}`}>{permit.message}</p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-500">Permit date{permit.permitNumber ? ` (${permit.permitNumber})` : ""}</dt>
          <dd>
            <D value={permit.permitDate} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Paid through</dt>
          <dd>FY {s.coveredThrough}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Valid until</dt>
          <dd>
            <D value={s.validUntil} /> (end of Ashadh)
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Renewal window for FY {s.renewalFor.label}</dt>
          <dd>
            <D value={s.renewalFor.opens} /> to <D value={s.renewalFor.deadline} />
          </dd>
        </div>
        {s.state === "expired" && (
          <>
            <div>
              <dt className="text-xs text-gray-500">Months late</dt>
              <dd className="text-[var(--status-critical-text)]">{s.monthsLate}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Late renewal fine</dt>
              <dd>{s.penalty ? (s.penalty.fine !== null ? `${money(s.penalty.fine)} (${s.penalty.rate * 100}% of the fee)` : `${s.penalty.rate * 100}% of the standard fee`) : "Confirm with the Inland Revenue Office"}</dd>
            </div>
          </>
        )}
      </dl>
      {s.state === "expired" && permit.ruleVerified === false && <p className="text-xs text-gray-500">The late-renewal bands have not been verified against current law. Confirm the fine with the Inland Revenue Office before paying.</p>}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Standard annual renewal fee (Rs)</label>
          <input className={`${input} w-40`} inputMode="decimal" disabled={!canEdit} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="Not set" />
        </div>
        {canEdit && (
          <button type="button" disabled={busy || fee === (permit.standardFee != null ? String(permit.standardFee) : "")} onClick={saveFee} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Save fee
          </button>
        )}
        <p className="text-xs text-gray-500">The late fine is a share of this fee.</p>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Renewals recorded</h3>
          {canEdit && permit.renewals.length > 0 && (
            <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setUndoing(true)}>
              Take back the latest
            </button>
          )}
        </div>
        {permit.renewals.length === 0 ? (
          <p className="text-sm text-gray-500">None yet. The fiscal year the permit was issued in is counted as paid.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Fiscal year</th>
                <th className="px-3 py-2 font-medium">Paid on</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 text-right font-medium">Late fine</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {[...permit.renewals].reverse().map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">FY {r.fiscalYear}</td>
                  <td className="px-3 py-2">
                    <D value={r.paidDate} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.feeAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.penaltyAmount > 0 ? money(r.penaltyAmount) : "—"}</td>
                  <td className="px-3 py-2">{r.receiptReference || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {renewing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setRenewing(null)} />
          <div className="relative w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900">Record renewal for FY {s.renewalFor.label}</h2>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Date paid</label>
              <DatePicker value={renewing.paidDate} max={todayIso()} onChange={(v) => setRenewing({ ...renewing, paidDate: v })} className={`${input} w-full`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Renewal fee paid (Rs)</label>
                <input className={`${input} w-full`} inputMode="decimal" value={renewing.fee} onChange={(e) => setRenewing({ ...renewing, fee: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Late fine paid (Rs)</label>
                <input className={`${input} w-full`} inputMode="decimal" value={renewing.fine} onChange={(e) => setRenewing({ ...renewing, fine: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Receipt reference</label>
              <input className={`${input} w-full`} value={renewing.receipt} onChange={(e) => setRenewing({ ...renewing, receipt: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">Notes (optional)</label>
              <input className={`${input} w-full`} value={renewing.notes} onChange={(e) => setRenewing({ ...renewing, notes: e.target.value })} />
            </div>
            <p className="text-xs text-gray-500">This records the renewal and marks the renewal item as paid. To post the money itself, use Payments.</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setRenewing(null)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={submitRenewal} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
                {busy ? "Saving..." : "Record renewal"}
              </button>
            </div>
          </div>
        </div>
      )}
      {undoing && <ConfirmDialog message="Take back the latest renewal? Its fiscal year becomes due again." onYes={undo} onNo={() => setUndoing(false)} />}
      {dialog}
    </section>
  );
}
