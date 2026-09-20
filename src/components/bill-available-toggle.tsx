"use client";

/**
 * "Bill physically available?" — Yes / No. Recorded on every purchase and expense as an audit-readiness input
 * (the audit-readiness view that reads it comes later).
 */
export function BillAvailableToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">Bill physically available?</label>
      <div className="inline-flex rounded-full bg-gray-100 p-0.5" role="radiogroup" aria-label="Bill physically available">
        {[
          { v: true, label: "Yes" },
          { v: false, label: "No" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            className={`rounded-full px-4 py-1 text-sm transition-colors disabled:opacity-50 ${
              value === o.v ? (o.v ? "bg-white font-medium text-green-700 shadow-sm" : "bg-white font-medium text-amber-700 shadow-sm") : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
