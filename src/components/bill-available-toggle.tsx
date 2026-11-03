"use client";

/**
 * "Bill physically available?" — Yes / No. Recorded on every purchase and expense as an audit-readiness input
 * (the audit-readiness view that reads it comes later).
 */
export function BillAvailableToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-2">Bill physically available?</label>
      <div className="inline-flex rounded-md border border-line bg-surface-2 p-0.5" role="radiogroup" aria-label="Bill physically available">
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
            className={`rounded px-3.5 py-0.5 text-[13px] transition-colors disabled:opacity-50 ${
              value === o.v ? (o.v ? "bg-surface font-medium text-[var(--success-text)] shadow-[var(--shadow-sm)]" : "bg-surface font-medium text-[var(--warning-text)] shadow-[var(--shadow-sm)]") : "text-ink-2 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
