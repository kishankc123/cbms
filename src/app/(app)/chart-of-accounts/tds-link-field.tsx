"use client";

import type { TdsHead } from "@/lib/ledger/tds-links";

// "Is this subject to TDS?" for an expense account or group. The value is what gets saved: null (follow the group above, if any), "none"
// (exempt) or a heading key. The rate is only shown, never typed: the platform administrator sets it.
export function TdsLinkField({ heads, value, onChange, inherited }: { heads: TdsHead[]; value: string | null; onChange: (v: string | null) => void; inherited: TdsHead | null }) {
  const choices = heads.filter((h) => h.kind === "rate");
  const subject = value === "none" ? false : value !== null || inherited !== null;
  const show = (h: TdsHead) => (h.rate === null ? `${h.name} (rate not set yet)` : `${h.name} — ${h.rate}%`);
  if (choices.length === 0) return null;

  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
      <label className="flex items-center gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={subject} onChange={(e) => onChange(e.target.checked ? (inherited ? null : choices[0].key) : inherited ? "none" : null)} />
        Payments to this are subject to TDS
      </label>
      {subject && (
        <select data-field="tdsHead" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm">
          {inherited ? <option value="">Same as the group — {show(inherited)}</option> : <option value="" disabled>Choose a heading</option>}
          {choices.map((h) => (
            <option key={h.key} value={h.key}>
              {show(h)}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-gray-500">The rate is set by the platform administrator. It is applied automatically when you record an expense.</p>
    </div>
  );
}
