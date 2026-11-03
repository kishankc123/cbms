// Loading placeholders: quiet grey blocks where content will appear, so a page doesn't jump when its data arrives.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-line ${className}`} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-[var(--border)] border-y border-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-9 items-center gap-6 px-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? "w-24" : c === cols - 1 ? "ml-auto w-16" : "w-32"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
