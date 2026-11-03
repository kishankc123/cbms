// A row of headline figures above a list ("Total expenses", "Unpaid"...). Not a row of cards: just figures between thin
// dividers, so the page stays light. A figure can be marked as a warning or a problem (unpaid, overdue) to draw the eye.

export type Stat = { label: string; value: React.ReactNode; tone?: "default" | "warning" | "danger" };

const TONE = { default: "text-ink", warning: "text-[var(--warning-text)]", danger: "text-[var(--danger-text)]" } as const;

export function StatStrip({ items, className = "" }: { items: Stat[]; className?: string }) {
  return (
    <div className={`flex flex-wrap border-y border-line ${className}`}>
      {items.map((s) => (
        <div key={s.label} className="min-w-[45%] flex-1 border-l border-line px-4 py-2.5 first:border-l-0 first:pl-0 sm:min-w-0">
          <p className="text-xs text-ink-2">{s.label}</p>
          <p className={`mt-0.5 text-lg font-semibold leading-6 tnum ${TONE[s.tone ?? "default"]}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
