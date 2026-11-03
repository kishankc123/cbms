import Link from "next/link";
import { ChevronLeft } from "lucide-react";

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
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-[var(--border)] ${className ?? ""}`}
    >
      <ChevronLeft size={16} strokeWidth={2} />
    </Link>
  );
}
