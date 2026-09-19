// Shared status-pill design system: soft background tint + high-contrast
// dark text, never a bright saturated fill. Map each domain status string to
// one of these four tones at the call site — do not invent new ad-hoc
// color classes for status badges.
export type StatusTone = "success" | "pending" | "action" | "critical";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]",
  pending: "bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] border-[var(--status-pending-border)]",
  action: "bg-[var(--status-action-bg)] text-[var(--status-action-text)] border-[var(--status-action-border)]",
  critical: "bg-[var(--status-critical-bg)] text-[var(--status-critical-text)] border-[var(--status-critical-border)]",
};

export function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

// Small bright badge-count circle for critical notification counts (e.g. an
// unread/overdue count on a nav item or icon) — the one place this system
// intentionally uses a saturated fill instead of a soft tint.
export function CriticalCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-critical-dot)] px-1 text-[10px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
