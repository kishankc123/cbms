"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createInterTransfer, updateInterTransfer, getSourceBalance } from "./actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { D } from "@/components/calendar/date-text";
type Option = { id: string; label: string; kind: "Cash" | "Bank" };
export type TransferInitial = {
  id: string;
  transferNumber: string;
  transferDate: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  reference: string | null;
  description: string | null;
  attachmentUrl: string | null;
};

const today = () => todayIso();
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const errCls = "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";

function AccountSelect({ value, onChange, options, exclude, hasError }: { value: string; onChange: (v: string) => void; options: Option[]; exclude: string; hasError: boolean }) {
  const cash = options.filter((o) => o.kind === "Cash");
  const bank = options.filter((o) => o.kind === "Bank");
  const render = (list: Option[]) => list.map((o) => (
    <option key={o.id} value={o.id} disabled={o.id === exclude}>
      {o.label}
    </option>
  ));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={hasError ? errCls : inputCls}>
      <option value="">Select account</option>
      {cash.length > 0 && <optgroup label="Cash">{render(cash)}</optgroup>}
      {bank.length > 0 && <optgroup label="Bank">{render(bank)}</optgroup>}
    </select>
  );
}

export function TransferForm({ options, initial }: { options: Option[]; initial?: TransferInitial }) {
  const router = useRouter();
  const [transferDate, setTransferDate] = useState(initial?.transferDate ?? today());
  const [fromAccountId, setFromAccountId] = useState(initial?.fromAccountId ?? "");
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [attachmentUrl, setAttachmentUrl] = useState(initial?.attachmentUrl ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ balanceWarning: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ id: string; transferNumber: string } | null>(null);
  const submitting = useRef(false);

  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? "";
  const amountNum = parseFloat(amount) || 0;

  async function handleSave() {
    const e: Record<string, string> = {};
    if (!transferDate) e.transferDate = "Please enter the transfer date.";
    if (!fromAccountId) e.fromAccountId = "Please select the From Account.";
    if (!toAccountId) e.toAccountId = "Please select the To Account.";
    if (fromAccountId && fromAccountId === toAccountId) e.toAccountId = "From Account and To Account cannot be the same.";
    if (!(amountNum > 0)) e.amount = "Amount must be greater than zero.";
    setErrors(e);
    setServerError(null);
    if (Object.keys(e).length > 0) return;

    let balanceWarning: string | null = null;
    try {
      let available = await getSourceBalance(fromAccountId);
      // When editing, the transfer's own credit is already in the balance.
      if (initial && initial.fromAccountId === fromAccountId) available += initial.amount;
      if (available < amountNum) {
        balanceWarning = `${labelOf(fromAccountId)} has an available balance of ${fmt(available)}, which is less than this transfer. It will go negative if you continue.`;
      }
    } catch {
      /* balance check is advisory only */
    }
    setConfirming({ balanceWarning });
  }

  async function handleConfirm() {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setServerError(null);
    try {
      const payload = { transferDate, fromAccountId, toAccountId, amount: amountNum, reference, description, attachmentUrl };
      if (initial) {
        await updateInterTransfer(initial.id, payload);
        router.push(`/payments/inter-transfer/${initial.id}`);
        router.refresh();
        return;
      }
      const result = await createInterTransfer(payload);
      setConfirming(null);
      setDone(result);
    } catch (err) {
      setConfirming(null);
      setServerError(err instanceof Error ? err.message : "Failed to save transfer");
      submitting.current = false;
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-xl rounded-lg border border-green-200 bg-white p-6 space-y-4">
        <p className="text-base font-semibold text-green-700">Transfer recorded successfully.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span className="text-gray-500">Transfer No.</span><span>{done.transferNumber}</span>
          <span className="text-gray-500">Amount</span><span>{fmt(amountNum)}</span>
          <span className="text-gray-500">From</span><span>{labelOf(fromAccountId)}</span>
          <span className="text-gray-500">To</span><span>{labelOf(toAccountId)}</span>
        </div>
        <div className="flex gap-2">
          <Link href={`/payments/inter-transfer/${done.id}`} className="rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-4 py-1.5">
            View Transfer
          </Link>
          <a href="/payments/inter-transfer/new" className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-4 py-1.5">
            New Transfer
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Transfer No.</label>
            <input value={initial?.transferNumber ?? "Auto-generated on save"} disabled className="w-full rounded bg-gray-50 px-2 py-1.5 text-sm text-gray-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Transfer Date</label>
            <DatePicker value={transferDate} onChange={(v) => setTransferDate(v)} className={errors.transferDate ? errCls : inputCls} />
            {errors.transferDate && <p className="mt-1 text-xs text-red-600">{errors.transferDate}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From Account</label>
            <AccountSelect value={fromAccountId} onChange={setFromAccountId} options={options} exclude={toAccountId} hasError={!!errors.fromAccountId} />
            {errors.fromAccountId && <p className="mt-1 text-xs text-red-600">{errors.fromAccountId}</p>}
          </div>
          <div className="hidden sm:flex h-full items-end pb-1.5 text-xl text-gray-400">→</div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To Account</label>
            <AccountSelect value={toAccountId} onChange={setToAccountId} options={options} exclude={fromAccountId} hasError={!!errors.toAccountId} />
            {errors.toAccountId && <p className="mt-1 text-xs text-red-600">{errors.toAccountId}</p>}
          </div>
        </div>

        <div className="max-w-xs">
          <label className="block text-xs text-gray-500 mb-1">Amount</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${errors.amount ? errCls : inputCls} text-lg font-semibold`} />
          {errors.amount && <p className="mt-1 text-xs text-red-600">{errors.amount}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reference (optional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Attachment (optional)</label>
            <input value={attachmentUrl} onChange={(e) => setAttachmentUrl(e.target.value)} placeholder="Paste a link or filename" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={handleSave} disabled={saving} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50">
          {initial ? "Save Changes" : "Save Transfer"}
        </button>
        <Link href={initial ? `/payments/inter-transfer/${initial.id}` : "/payments/inter-transfer"} className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </Link>
        {serverError && <span className="text-sm text-red-600">{serverError}</span>}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !saving && setConfirming(null)} />
          <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Confirm Transfer</h3>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-500">From Account</span><span>{labelOf(fromAccountId)}</span>
              <span className="text-gray-500">To Account</span><span>{labelOf(toAccountId)}</span>
              <span className="text-gray-500">Amount</span><span className="font-semibold">{fmt(amountNum)}</span>
              <span className="text-gray-500">Date</span><span><D value={transferDate} /></span>
              <span className="text-gray-500">Reference</span><span>{reference || "—"}</span>
            </div>
            {confirming.balanceWarning && (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{confirming.balanceWarning}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} disabled={saving} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={handleConfirm} disabled={saving} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                {saving ? "Posting..." : "Confirm Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
