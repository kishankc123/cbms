import type { LucideIcon } from "lucide-react";

/** What a list or page shows when there is nothing in it yet: what it is for, and (if there is one) the action that fills it. */
export function EmptyState({ icon: Icon, title, description, action, className = "" }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center px-4 py-10 text-center ${className}`}>
      {Icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
          <Icon size={18} strokeWidth={1.75} />
        </div>
      )}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-2">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
