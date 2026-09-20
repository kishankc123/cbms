"use client";

import { useState } from "react";
import * as actions from "../ownership-actions";
import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";

type Data = Awaited<ReturnType<typeof actions.getOwnership>>;
type Holder = Data["holders"][number];

const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50";
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
export const money = (n: number, currency = "") => `${currency ? currency + " " : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Field({ label, hint, children, span }: { label: string; hint?: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`relative w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-lg bg-white p-5 shadow-lg`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Meta = { effectiveDate: string; reason: string; referenceNumber: string; supportingDocument: string; notes: string };
const blankMeta = (): Meta => ({ effectiveDate: todayIso(), reason: "", referenceNumber: "", supportingDocument: "", notes: "" });

function MetaFields({ meta, set, dateLabel = "Effective date", noReason }: { meta: Meta; set: (m: Meta) => void; dateLabel?: string; noReason?: boolean }) {
  return (
    <>
      <Field label={dateLabel}>
        <DatePicker value={meta.effectiveDate} onChange={(v) => set({ ...meta, effectiveDate: v })} className={input} />
      </Field>
      <Field label="Reference number">
        <input className={input} value={meta.referenceNumber} onChange={(e) => set({ ...meta, referenceNumber: e.target.value })} />
      </Field>
      {!noReason && (
        <Field label="Reason" span>
          <input className={input} value={meta.reason} onChange={(e) => set({ ...meta, reason: e.target.value })} />
        </Field>
      )}
      <Field label="Supporting document (reference)" span>
        <input className={input} value={meta.supportingDocument} onChange={(e) => set({ ...meta, supportingDocument: e.target.value })} placeholder="Link or file name" />
      </Field>
      <Field label="Notes" span>
        <textarea rows={2} className={input} value={meta.notes} onChange={(e) => set({ ...meta, notes: e.target.value })} />
      </Field>
    </>
  );
}

/** Shared shell: runs an action, shows its error, closes on success. */
function Form({ title, onClose, onDone, submitLabel, disabled, run, children, wide }: { title: string; onClose: () => void; onDone: () => void; submitLabel: string; disabled?: boolean; run: () => Promise<unknown>; children: React.ReactNode; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await run();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <div className="grid grid-cols-2 gap-3">{children}</div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button type="button" disabled={busy || disabled} onClick={submit} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
          {busy ? "Saving..." : submitLabel}
        </button>
      </div>
    </Modal>
  );
}

type Common = { onClose: () => void; onDone: () => void };

// ------------------------------------------------------------- capital structure

export function SetupCapitalForm({ currency, ...c }: Common & { currency: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [authorised, setAuthorised] = useState("");
  const [face, setFace] = useState("");
  const [shares, setShares] = useState("");
  const issued = num(shares) * num(face);
  return (
    <Form title="Set up capital" submitLabel="Save" {...c} disabled={!(num(face) > 0) || !(num(shares) >= 0)} run={() => actions.setupCapital({ ...meta, authorisedCapital: num(authorised) || 0, faceValue: num(face), issuedShares: num(shares), currency })}>
      <Field label={`Authorised capital (${currency})`}>
        <input type="number" min="0" className={input} value={authorised} onChange={(e) => setAuthorised(e.target.value)} />
      </Field>
      <Field label="Face value per share">
        <input type="number" min="0" step="0.01" className={input} value={face} onChange={(e) => setFace(e.target.value)} />
      </Field>
      <Field label="Total shares issued" hint={Number.isFinite(issued) && issued > 0 ? `Issued capital: ${money(issued, currency)}` : undefined}>
        <input type="number" min="0" step="1" className={input} value={shares} onChange={(e) => setShares(e.target.value)} />
      </Field>
      <MetaFields meta={meta} set={setMeta} dateLabel="As of date" noReason />
    </Form>
  );
}

export function AuthorisedForm({ current, currency, ...c }: Common & { current: number; currency: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [amount, setAmount] = useState("");
  return (
    <Form title="Increase authorised capital" submitLabel="Record" {...c} disabled={!(num(amount) > current)} run={() => actions.increaseAuthorisedCapital({ ...meta, newAmount: num(amount) })}>
      <Field label="Current">
        <input className={input} disabled value={money(current, currency)} readOnly />
      </Field>
      <Field label="New authorised capital">
        <input type="number" min="0" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

export function FaceValueForm({ current, currency, ...c }: Common & { current: number; currency: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [value, setValue] = useState("");
  return (
    <Form title="Change face value per share" submitLabel="Record" {...c} disabled={!(num(value) > 0)} run={() => actions.changeFaceValue({ ...meta, newFaceValue: num(value) })}>
      <Field label="Current">
        <input className={input} disabled value={money(current, currency)} readOnly />
      </Field>
      <Field label="New face value">
        <input type="number" min="0" step="0.01" className={input} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

// ------------------------------------------------------------- shareholders

const HOLDER_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "company", label: "Company" },
  { value: "other", label: "Other" },
];

export function ShareholderForm({ holder, unallocated, ...c }: Common & { holder?: Holder; unallocated: number }) {
  const [meta, setMeta] = useState(blankMeta());
  const [name, setName] = useState(holder?.name ?? "");
  const [type, setType] = useState(holder?.holderType ?? "individual");
  const [cls, setCls] = useState(holder?.shareClass ?? "Ordinary");
  const [shares, setShares] = useState("");
  const [acquired, setAcquired] = useState(holder?.dateAcquired ?? "");
  const [notes, setNotes] = useState(holder?.notes ?? "");

  return (
    <Form
      title={holder ? `Edit ${holder.name}` : "Add shareholder"}
      submitLabel={holder ? "Save" : "Add shareholder"}
      {...c}
      disabled={!name.trim()}
      run={() =>
        holder
          ? actions.updateShareholder({ id: holder.id, name, holderType: type, shareClass: cls, dateAcquired: acquired, notes })
          : actions.addShareholder({ ...meta, notes, name, holderType: type, shareClass: cls, shares: num(shares) || 0, dateAcquired: acquired })
      }
    >
      <Field label="Shareholder name" span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Type">
        <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
          {HOLDER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Share class">
        <input className={input} value={cls} onChange={(e) => setCls(e.target.value)} />
      </Field>
      {!holder && (
        <Field label="Number of shares" hint={`${unallocated.toLocaleString()} issued shares are still unallocated. Issue more shares first if you need more.`}>
          <input type="number" min="0" step="1" className={input} value={shares} onChange={(e) => setShares(e.target.value)} />
        </Field>
      )}
      <Field label="Date acquired">
        <DatePicker value={acquired} onChange={setAcquired} className={input} />
      </Field>
      {!holder && (
        <>
          <Field label="Reference number">
            <input className={input} value={meta.referenceNumber} onChange={(e) => setMeta({ ...meta, referenceNumber: e.target.value })} />
          </Field>
          <Field label="Effective date">
            <DatePicker value={meta.effectiveDate} onChange={(v) => setMeta({ ...meta, effectiveDate: v })} className={input} />
          </Field>
          <Field label="Supporting document (reference)">
            <input className={input} value={meta.supportingDocument} onChange={(e) => setMeta({ ...meta, supportingDocument: e.target.value })} />
          </Field>
        </>
      )}
      <Field label="Notes" span>
        <textarea rows={2} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Form>
  );
}

function HolderSelect({ holders, value, onChange, label, exclude }: { holders: Holder[]; value: string; onChange: (v: string) => void; label: string; exclude?: string }) {
  return (
    <Field label={label}>
      <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select shareholder</option>
        {holders
          .filter((h) => h.status === "active" && h.id !== exclude)
          .map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.sharesHeld.toLocaleString()} shares)
            </option>
          ))}
      </select>
    </Field>
  );
}

export function IssueSharesForm({ holders, presetId, ...c }: Common & { holders: Holder[]; presetId?: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [holderId, setHolderId] = useState(presetId ?? "");
  const [shares, setShares] = useState("");
  return (
    <Form title="Issue new shares" submitLabel="Record" {...c} disabled={!holderId || !(num(shares) > 0)} run={() => actions.issueShares({ ...meta, shareholderId: holderId, shares: num(shares) })}>
      <HolderSelect holders={holders} value={holderId} onChange={setHolderId} label="Issue to" />
      <Field label="Number of shares">
        <input type="number" min="1" step="1" className={input} value={shares} onChange={(e) => setShares(e.target.value)} />
      </Field>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

export function CancelSharesForm({ holders, presetId, ...c }: Common & { holders: Holder[]; presetId?: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [holderId, setHolderId] = useState(presetId ?? "");
  const [shares, setShares] = useState("");
  return (
    <Form title="Cancel shares" submitLabel="Record" {...c} disabled={!holderId || !(num(shares) > 0)} run={() => actions.cancelShares({ ...meta, shareholderId: holderId, shares: num(shares) })}>
      <HolderSelect holders={holders} value={holderId} onChange={setHolderId} label="Shareholder" />
      <Field label="Number of shares">
        <input type="number" min="1" step="1" className={input} value={shares} onChange={(e) => setShares(e.target.value)} />
      </Field>
      <p className="col-span-2 text-xs text-gray-400">This changes the register only. Any capital returned to the shareholder is recorded as a payment.</p>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

export function TransferForm({ holders, currency, presetId, ...c }: Common & { holders: Holder[]; currency: string; presetId?: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [fromId, setFromId] = useState(presetId ?? "");
  const [toId, setToId] = useState("");
  const [shares, setShares] = useState("");
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const from = holders.find((h) => h.id === fromId);

  // Capital moves with the shares: suggest it in proportion, until the user types their own figure.
  async function suggest(nextFrom: string, nextShares: string) {
    if (touched || !nextFrom || !(num(nextShares) > 0)) return;
    try {
      setAmount(String(await actions.getTransferSuggestion(nextFrom, num(nextShares))));
    } catch {
      /* the suggestion is optional */
    }
  }

  return (
    <Form wide title="Record share transfer" submitLabel="Record transfer" {...c} disabled={!fromId || !toId || !(num(shares) > 0)} run={() => actions.transferShares({ ...meta, fromId, toId, shares: num(shares), amount: num(amount) || 0 })}>
      <HolderSelect holders={holders} value={fromId} onChange={(v) => { setFromId(v); suggest(v, shares); }} label="From" />
      <HolderSelect holders={holders} value={toId} onChange={setToId} label="To" exclude={fromId} />
      <Field label="Number of shares" hint={from ? `${from.name} holds ${from.sharesHeld.toLocaleString()} shares` : undefined}>
        <input type="number" min="1" step="1" className={input} value={shares} onChange={(e) => { setShares(e.target.value); suggest(fromId, e.target.value); }} />
      </Field>
      <Field label={`Paid capital moving with them (${currency})`} hint={from ? `${from.name} has ${money(from.paid)} recorded. Moves between their capital accounts in your books.` : undefined}>
        <input type="number" min="0" step="0.01" className={input} value={amount} onChange={(e) => { setAmount(e.target.value); setTouched(true); }} />
      </Field>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

export function PaidUpForm({ holders, cashBank, currency, presetId, ...c }: Common & { holders: Holder[]; cashBank: Data["cashBank"]; currency: string; presetId?: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [holderId, setHolderId] = useState(presetId ?? "");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(cashBank[0]?.id ?? "");
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque" | "card" | "online" | "other">("bank_transfer");
  const holder = holders.find((h) => h.id === holderId);

  async function run() {
    const r = await actions.recordPaidUpIncrease({ ...meta, shareholderId: holderId, amount: num(amount), accountId, paymentMethod: method });
    if (r.duplicateWarning) {
      if (!window.confirm("A very similar payment was recorded recently. Record this one anyway?")) throw new Error("Cancelled");
      await actions.recordPaidUpIncrease({ ...meta, shareholderId: holderId, amount: num(amount), accountId, paymentMethod: method, confirmDuplicate: true });
    }
  }

  return (
    <Form wide title="Record paid-up capital" submitLabel="Record" {...c} disabled={!holderId || !(num(amount) > 0) || !accountId} run={run}>
      <HolderSelect holders={holders} value={holderId} onChange={setHolderId} label="Received from" />
      <Field label={`Amount (${currency})`} hint={holder ? `Unpaid on their shares: ${money(holder.unpaid)}` : undefined}>
        <input type="number" min="0" step="0.01" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Received into">
        <select className={input} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {cashBank.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Method">
        <select className={input} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="online">Online</option>
          <option value="other">Other</option>
        </select>
      </Field>
      <p className="col-span-2 text-xs text-gray-400">This is recorded as a Money In payment (capital introduced), credited to the shareholder&apos;s capital account.</p>
      <MetaFields meta={meta} set={setMeta} dateLabel="Date received" />
    </Form>
  );
}

export function AssignForm({ holders, unassigned, currency, ...c }: Common & { holders: Holder[]; unassigned: number; currency: string }) {
  const [meta, setMeta] = useState(blankMeta());
  const [holderId, setHolderId] = useState("");
  const [amount, setAmount] = useState(String(unassigned));
  return (
    <Form title="Assign capital to a shareholder" submitLabel="Assign" {...c} disabled={!holderId || !(num(amount) > 0)} run={() => actions.assignExistingCapital({ ...meta, shareholderId: holderId, amount: num(amount) })}>
      <p className="col-span-2 text-xs text-gray-500">{money(unassigned, currency)} of paid-up capital is in your books but not assigned to a shareholder. Assigning it posts a reclassification entry.</p>
      <HolderSelect holders={holders} value={holderId} onChange={setHolderId} label="Assign to" />
      <Field label="Amount">
        <input type="number" min="0" step="0.01" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

export function DeactivateForm({ holder, ...c }: Common & { holder: Holder }) {
  const [meta, setMeta] = useState(blankMeta());
  return (
    <Form title={`Mark ${holder.name} inactive`} submitLabel="Mark inactive" {...c} run={() => actions.deactivateShareholder(holder.id, meta)}>
      <p className="col-span-2 text-xs text-gray-500">Their history stays. This is only possible once they hold no shares and have no capital in the books.</p>
      <MetaFields meta={meta} set={setMeta} />
    </Form>
  );
}

// ------------------------------------------------------------- Share Lagat

export function ShareLagatForm(c: Common) {
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [doc, setDoc] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Form title="Record Share Lagat update" submitLabel="Record update" {...c} disabled={!date} run={() => actions.recordShareLagatUpdate({ lastUpdatedDate: date, referenceNumber: reference, supportingDocument: doc, reason, notes })}>
      <Field label="Updated on">
        <DatePicker value={date} onChange={setDate} className={input} />
      </Field>
      <Field label="Reference number">
        <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
      <Field label="Reason for change" span>
        <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New shareholder added" />
      </Field>
      <Field label="Supporting document (reference)" span>
        <input className={input} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Link or file name" />
      </Field>
      <Field label="Notes" span>
        <textarea rows={2} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Form>
  );
}
