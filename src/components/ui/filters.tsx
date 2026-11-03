import { Search, X } from "lucide-react";
import { controlClass } from "./field";

/** The row above a table: a search box, then filters, then (pushed right) anything else. */
export function FilterBar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-3 flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

export function SearchInput({ value, onChange, placeholder = "Search", className = "" }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative w-full max-w-64 ${className}`}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${controlClass} w-full pl-8`} />
    </div>
  );
}

/** A filter that is switched on, shown as a small removable tag: "Status: Unpaid ✕". */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface-2 pl-2 pr-1 text-xs text-ink">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="flex h-4 w-4 items-center justify-center rounded text-ink-2 transition-colors hover:bg-hover hover:text-ink">
        <X size={12} />
      </button>
    </span>
  );
}
