"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getTaxRateInfo, listTaxRateHistory, updateTaxRate } from "../tax-rate-actions";
import { useProblem } from "@/components/problem-dialog";
import { DatePicker } from "@/components/calendar/date-picker";
import { D } from "@/components/calendar/date-text";
import { todayIso } from "@/lib/calendar";
import type { TaxRateRow, TaxTypeKey } from "@/lib/compliance/tax-rates";

const inputCls = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm";

// A tax rate is never just edited: a change takes effect from a date, and the rate before that date stays on the
// record — so a transaction dated in the past (even one entered after the fact) is always taxed at whatever
// actually applied on its own date, not at today's rate. Once rates can be published centrally by a platform
// administrator, this same screen keeps working: `source` just switches it to read-only for that tax type.
export function TaxRatesPanel() {
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-gray-500">
        A rate change takes effect from a date you choose — it never edits what already applied. Every document keeps the rate that was actually in
        force on its own date, whenever it is entered.
      </p>
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <RateCard taxTypeKey="vat" label="VAT" />
        <RateCard taxTypeKey="tds" label="TDS" />
      </div>
    </div>
  );
}

function RateCard({ taxTypeKey, label }: { taxTypeKey: TaxTypeKey; label: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<{ rate: number; source: "manual" | "platform"; effectiveFrom: string | null } | null>(null);
  const [changing, setChanging] = useState(false);
  const [history, setHistory] = useState<TaxRateRow[] | null>(null);

  useEffect(() => {
    getTaxRateInfo(taxTypeKey).then(setInfo);
  }, [taxTypeKey]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-xs text-gray-500 mb-1">{label} rate</label>
          <p className="text-lg font-semibold text-gray-900">{info ? `${info.rate}%` : "…"}</p>
          {info?.source === "platform" && <p className="text-xs text-gray-500">Published by your administrator</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {info?.source !== "platform" && (
            <button type="button" onClick={() => setChanging(true)} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50">
              Change rate
            </button>
          )}
          <button
            type="button"
            onClick={() => (history ? setHistory(null) : listTaxRateHistory(taxTypeKey).then(setHistory))}
            className="text-xs text-gray-500 hover:underline"
          >
            {history ? "Hide history" : "View history"}
          </button>
        </div>
      </div>

      {history && (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Rate</th>
              <th className="py-1 pr-3 font-medium">From</th>
              <th className="py-1 font-medium">To</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="py-1 pr-3">
                  {r.rate}%{r.source === "platform" && <span className="ml-1 text-gray-400">(published)</span>}
                </td>
                <td className="py-1 pr-3"><D value={r.effectiveFrom} /></td>
                <td className="py-1 text-gray-500">{r.effectiveTo ? <D value={r.effectiveTo} /> : "current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {changing && info && (
        <ChangeRateModal
          taxTypeKey={taxTypeKey}
          label={label}
          current={info.rate}
          onClose={() => setChanging(false)}
          onSaved={() => {
            setChanging(false);
            setHistory(null);
            getTaxRateInfo(taxTypeKey).then(setInfo);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ChangeRateModal({
  taxTypeKey,
  label,
  current,
  onClose,
  onSaved,
}: {
  taxTypeKey: TaxTypeKey;
  label: string;
  current: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { report, dialog } = useProblem();
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = parseFloat(rate);
    if (!(value >= 0) || value > 100) return report("Enter a rate between 0 and 100.", '[data-field="rate"]');
    if (!effectiveFrom) return report("Choose the date the new rate takes effect.", null);
    setSaving(true);
    try {
      await updateTaxRate({ taxTypeKey, rate: value, effectiveFrom, reason });
      onSaved();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-lg">
        <h2 className="text-base font-semibold text-gray-900">Change the {label} rate</h2>
        <p className="text-xs text-gray-500">
          Currently {current}%. The new rate applies from the date below onward; every document already dated before it keeps taxing at {current}%, and a document you
          backdate into that period will too.
        </p>
        <div>
          <label className="mb-1 block text-xs text-gray-500">New rate (%)</label>
          <input data-field="rate" type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Effective from</label>
          <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Government rate change" className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
