// Stacked horizontal row-card list — the standard replacement for
// grid-lined <table> rows wherever a list is primarily scanned rather than
// compared column-by-column (activity feeds, transaction lists, exception
// queues, etc.). Each row is a white card with a subtle border; metadata
// (icons, dates, categories) stays small and muted, financial/primary
// metrics sit on the right in bold high-contrast type, and row-level
// actions (View, three-dot menu) sit at the far right edge.
export function RowCardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export function RowCard({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 ${
        onClick ? "cursor-pointer hover:border-gray-300 hover:shadow-sm" : ""
      }`}
    >
      {children}
    </div>
  );
}

// Left-hand cluster: an optional micro-icon plus stacked title/meta text.
export function RowMeta({
  icon,
  title,
  subtitle,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">{title}</p>
        {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

// Right-hand cluster: the bold high-contrast metric (e.g. remaining
// balance) plus an optional status pill and row actions.
export function RowValue({
  primary,
  secondary,
  children,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <div className="text-right">
        <p className="text-sm font-bold text-gray-900">{primary}</p>
        {secondary && <p className="text-xs text-gray-500">{secondary}</p>}
      </div>
      {children}
    </div>
  );
}
