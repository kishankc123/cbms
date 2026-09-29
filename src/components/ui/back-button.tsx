import Link from "next/link";

/**
 * Circular icon-only "back" affordance — the shared replacement for the inline "← Label" text
 * links pages used to hand-roll (inconsistently: some accent-colored, some gray). New or touched
 * pages should use this instead of a fresh text link; existing ones aren't retrofitted in one pass,
 * the same incremental approach StatusPill/RowCard were rolled out with (see design-system memory).
 * `label` is required for the accessible name (and the hover tooltip) since the button itself is
 * icon-only — say where it goes, e.g. "Back to Settings", not just "Back".
 */
export function BackButton({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted-bg)] text-[var(--text-primary)] transition-colors hover:bg-[var(--card-border)] ${className ?? ""}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </Link>
  );
}
