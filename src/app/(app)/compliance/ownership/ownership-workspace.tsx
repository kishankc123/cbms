"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { getOwnership } from "../ownership-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import {
  AssignForm,
  AuthorisedForm,
  CancelSharesForm,
  DeactivateForm,
  FaceValueForm,
  IssueSharesForm,
  Modal,
  PaidUpForm,
  SetupCapitalForm,
  ShareLagatForm,
  ShareholderForm,
  TransferForm,
  money,
} from "./forms";

type Data = Awaited<ReturnType<typeof getOwnership>>;
type Holder = Data["holders"][number];
type Change = Data["changes"][number];

type Dialog =
  | { kind: "setup" }
  | { kind: "authorised" }
  | { kind: "faceValue" }
  | { kind: "add" }
  | { kind: "edit"; holder: Holder }
  | { kind: "view"; holder: Holder }
  | { kind: "issue"; presetId?: string }
  | { kind: "cancel"; presetId?: string }
  | { kind: "transfer"; presetId?: string }
  | { kind: "paidUp"; presetId?: string }
  | { kind: "assign" }
  | { kind: "deactivate"; holder: Holder }
  | { kind: "lagat" }
  | null;

const TYPE_LABEL: Record<string, string> = {
  initial_setup: "Capital set up",
  authorised_capital_increase: "Authorised capital increased",
  shares_issued: "Shares issued",
  paid_up_capital_increase: "Paid-up capital received",
  share_transfer: "Share transfer",
  share_cancellation: "Shares cancelled",
  face_value_change: "Face value changed",
  capital_assignment: "Capital assigned to shareholder",
  shareholder_added: "Shareholder added",
  shareholder_deactivated: "Shareholder marked inactive",
  other: "Other change",
};

const HOLDER_TYPE_LABEL: Record<string, string> = { individual: "Individual", company: "Company", other: "Other" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function OwnershipWorkspace({ data }: { data: Data }) {
  const router = useRouter();
  const [tab, setTab] = useState<"holders" | "changes" | "lagat">("holders");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState(false);
  const cur = data.capital.currency;
  const active = data.holders.filter((h) => h.status === "active");
  const canEdit = data.canEdit;

  const close = () => setDialog(null);
  const done = () => {
    setDialog(null);
    router.refresh();
  };
  const common = { onClose: close, onDone: done };

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <div className="relative">
            <button type="button" disabled={!data.capital.exists} onClick={() => setMenu((v) => !v)} className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              + Record Capital Change ▾
            </button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
                {[
                  { k: "authorised", label: "Increase authorised capital" },
                  { k: "issue", label: "Issue new shares" },
                  { k: "paidUp", label: "Record paid-up capital", disabled: !data.canPay },
                  { k: "transfer", label: "Share transfer" },
                  { k: "cancel", label: "Cancel shares" },
                  { k: "faceValue", label: "Change face value" },
                ].map((m) => (
                  <button
                    key={m.k}
                    type="button"
                    disabled={m.disabled}
                    onClick={() => {
                      setMenu(false);
                      setDialog({ kind: m.k } as Dialog);
                    }}
                    className="block w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:text-gray-300"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" disabled={!data.capital.exists} onClick={() => setDialog({ kind: "add" })} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-40">
            + Add Shareholder
          </button>
        </div>
      )}

      {!data.capital.exists ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">Your capital structure isn&apos;t set up yet.</p>
          {canEdit && (
            <button type="button" onClick={() => setDialog({ kind: "setup" })} className="mt-3 rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
              Set up capital
            </button>
          )}
        </div>
      ) : (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Capital information</h2>
          <div className="grid grid-cols-4 gap-6">
            <Stat label="Authorised capital" value={money(data.capital.authorisedCapital, cur)} />
            <Stat label="Issued capital" value={money(data.capital.issuedCapital, cur)} sub={`${data.capital.issuedShares.toLocaleString()} shares × ${money(data.capital.faceValue)}`} />
            <Stat label="Paid-up capital" value={money(data.capital.paidUpCapital, cur)} sub="From your books" />
            <Stat label="Total shares" value={data.capital.issuedShares.toLocaleString()} sub={`Face value ${money(data.capital.faceValue, cur)}`} />
          </div>
        </section>
      )}

      {data.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.warnings.map((w) => (
            <p key={w} className="flex items-center justify-between gap-3">
              <span>{w}</span>
              {canEdit && data.holders.length > 0 && w.includes("isn't assigned") && (
                <button type="button" onClick={() => setDialog({ kind: "assign" })} className="shrink-0 text-xs underline">
                  Assign to a shareholder
                </button>
              )}
              {w.startsWith("Share Lagat") && (
                <button type="button" onClick={() => setTab("lagat")} className="shrink-0 text-xs underline">
                  Open Share Lagat
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {(
          [
            ["holders", "Shareholders"],
            ["changes", "Capital changes"],
            ["lagat", "Share Lagat"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-[var(--color-primary)] font-medium text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "holders" && (
        <div className="space-y-3">
          <div className="flex items-center gap-6 text-sm text-gray-600">
            <span>
              Total shareholders: <span className="font-semibold text-gray-900">{active.length}</span>
            </span>
            <span>
              Total ownership: <span className={`font-semibold ${data.ownership.allocationPct < 100 && data.capital.issuedShares > 0 ? "text-amber-700" : "text-gray-900"}`}>{data.ownership.allocationPct}%</span>
            </span>
          </div>
          <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Shareholder</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Shares</th>
                <th className="px-3 py-2 font-medium text-right">Ownership</th>
                <th className="px-3 py-2 font-medium text-right">Paid</th>
                <th className="px-3 py-2 font-medium text-right">Unpaid</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Acquired</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.holders.map((h) => (
                <tr key={h.id} className={`border-t border-gray-100 ${h.status === "inactive" ? "text-gray-400" : ""}`}>
                  <td className="px-3 py-2 font-medium">{h.name}</td>
                  <td className="px-3 py-2">{HOLDER_TYPE_LABEL[h.holderType] ?? h.holderType}</td>
                  <td className="px-3 py-2 text-right">{h.sharesHeld.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{h.ownershipPct}%</td>
                  <td className="px-3 py-2 text-right">{money(h.paid)}</td>
                  <td className="px-3 py-2 text-right">{money(h.unpaid)}</td>
                  <td className="px-3 py-2">{h.shareClass}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{h.dateAcquired ? <D value={h.dateAcquired} /> : "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={h.status === "active" ? "success" : "action"}>{h.status === "active" ? "Active" : "Inactive"}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap space-x-2 text-xs">
                    <button type="button" onClick={() => setDialog({ kind: "view", holder: h })} className="text-[var(--color-primary)] hover:underline">
                      View
                    </button>
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => setDialog({ kind: "edit", holder: h })} className="text-[var(--color-primary)] hover:underline">
                          Edit
                        </button>
                        {h.status === "active" && (
                          <>
                            <button type="button" onClick={() => setDialog({ kind: "transfer", presetId: h.id })} className="text-[var(--color-primary)] hover:underline">
                              Transfer
                            </button>
                            <button type="button" onClick={() => setDialog({ kind: "deactivate", holder: h })} className="text-gray-500 hover:underline">
                              Mark inactive
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {data.holders.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                    No shareholders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "changes" && <ChangesTable changes={data.changes} currency={cur} />}

      {tab === "lagat" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-3 gap-8 text-sm">
              <div>
                <p className="text-xs text-gray-500">Share Lagat updated?</p>
                <p className="mt-1">
                  {data.lagat.current ? <StatusPill tone={data.lagat.current.status === "updated" ? "success" : "action"}>{data.lagat.current.status === "updated" ? "Yes" : "No — update needed"}</StatusPill> : <span className="text-gray-400">Not recorded</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Last updated</p>
                <p className="mt-1 text-gray-900">{data.lagat.current?.lastUpdatedDate ? <D value={data.lagat.current.lastUpdatedDate} /> : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Last change</p>
                <p className="mt-1 text-gray-900">{data.lagat.current?.lastChangeDate ? <D value={data.lagat.current.lastChangeDate} /> : "—"}</p>
              </div>
            </div>
            {canEdit && (
              <button type="button" onClick={() => setDialog({ kind: "lagat" })} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
                Record update
              </button>
            )}
          </div>
          <h3 className="text-sm font-semibold text-gray-900">Share Lagat history</h3>
          <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.lagat.history.map((e) => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <D value={e.status === "updated" ? e.lastUpdatedDate : e.lastChangeDate} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={e.status === "updated" ? "success" : "action"}>{e.status === "updated" ? "Updated" : "Update needed"}</StatusPill>
                  </td>
                  <td className="px-3 py-2">{e.reason || "—"}</td>
                  <td className="px-3 py-2">{e.referenceNumber || "—"}</td>
                  <td className="px-3 py-2">{e.supportingDocument || "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{e.notes || ""}</td>
                </tr>
              ))}
              {data.lagat.history.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No Share Lagat history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {dialog?.kind === "setup" && <SetupCapitalForm currency={cur} {...common} />}
      {dialog?.kind === "authorised" && <AuthorisedForm current={data.capital.authorisedCapital} currency={cur} {...common} />}
      {dialog?.kind === "faceValue" && <FaceValueForm current={data.capital.faceValue} currency={cur} {...common} />}
      {dialog?.kind === "add" && <ShareholderForm unallocated={data.ownership.unallocatedShares} {...common} />}
      {dialog?.kind === "edit" && <ShareholderForm holder={dialog.holder} unallocated={data.ownership.unallocatedShares} {...common} />}
      {dialog?.kind === "issue" && <IssueSharesForm holders={data.holders} presetId={dialog.presetId} {...common} />}
      {dialog?.kind === "cancel" && <CancelSharesForm holders={data.holders} presetId={dialog.presetId} {...common} />}
      {dialog?.kind === "transfer" && <TransferForm holders={data.holders} currency={cur} presetId={dialog.presetId} {...common} />}
      {dialog?.kind === "paidUp" && <PaidUpForm holders={data.holders} cashBank={data.cashBank} currency={cur} presetId={dialog.presetId} {...common} />}
      {dialog?.kind === "assign" && <AssignForm holders={data.holders} unassigned={data.capital.unassignedPaid} currency={cur} {...common} />}
      {dialog?.kind === "deactivate" && <DeactivateForm holder={dialog.holder} {...common} />}
      {dialog?.kind === "lagat" && <ShareLagatForm {...common} />}
      {dialog?.kind === "view" && (
        <Modal wide title={dialog.holder.name} onClose={close}>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Shares" value={dialog.holder.sharesHeld.toLocaleString()} sub={`${dialog.holder.ownershipPct}% of issued`} />
            <Stat label="Paid" value={money(dialog.holder.paid, cur)} />
            <Stat label="Unpaid" value={money(dialog.holder.unpaid, cur)} />
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            {HOLDER_TYPE_LABEL[dialog.holder.holderType]} · {dialog.holder.shareClass} shares
            {dialog.holder.notes ? ` · ${dialog.holder.notes}` : ""}
          </p>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-gray-900">History</h3>
          <ChangesTable changes={data.changes.filter((c) => c.shareholderId === dialog.holder.id || c.toShareholderId === dialog.holder.id)} currency={cur} compact />
        </Modal>
      )}
    </div>
  );
}

function describe(c: Change, currency: string): string {
  switch (c.type) {
    case "share_transfer":
      return `${c.shareholder} → ${c.toShareholder}`;
    case "authorised_capital_increase":
    case "face_value_change":
      return `${money(c.previousValue ?? 0, currency)} → ${money(c.newValue ?? 0, currency)}`;
    case "paid_up_capital_increase":
      return `${c.shareholder}: ${money(c.amount ?? 0, currency)} (paid-up ${money(c.previousValue ?? 0)} → ${money(c.newValue ?? 0)})`;
    case "capital_assignment":
      return `${c.shareholder}: ${money(c.amount ?? 0, currency)}`;
    case "initial_setup":
      return `Authorised ${money(c.newValue ?? 0, currency)}`;
    default:
      return c.shareholder;
  }
}

function ChangesTable({ changes, currency, compact }: { changes: Change[]; currency: string; compact?: boolean }) {
  return (
    <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
      <thead className="bg-gray-50 text-left text-gray-500">
        <tr>
          <th className="px-3 py-2 font-medium">Date</th>
          <th className="px-3 py-2 font-medium">Change</th>
          <th className="px-3 py-2 font-medium">Details</th>
          <th className="px-3 py-2 font-medium text-right">Shares</th>
          {!compact && <th className="px-3 py-2 font-medium">Reason / reference</th>}
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.id} className="border-t border-gray-100">
            <td className="px-3 py-2 whitespace-nowrap">
              <D value={c.date} />
            </td>
            <td className="px-3 py-2">{TYPE_LABEL[c.type] ?? c.type}</td>
            <td className="px-3 py-2">{describe(c, currency)}</td>
            <td className="px-3 py-2 text-right">{c.shares !== null ? c.shares.toLocaleString() : ""}</td>
            {!compact && (
              <td className="px-3 py-2 text-gray-500">
                {c.reason}
                {c.referenceNumber && <span className="ml-1 text-xs text-gray-400">({c.referenceNumber})</span>}
              </td>
            )}
          </tr>
        ))}
        {changes.length === 0 && (
          <tr>
            <td colSpan={compact ? 4 : 5} className="px-4 py-8 text-center text-gray-400">
              No changes recorded yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
