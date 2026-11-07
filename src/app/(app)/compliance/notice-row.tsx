import Link from "next/link";

// One slim line for something that needs doing in Compliance: what it is, a few words of why, and where to go. The full details (fees, fines, the list
// of what is missing) live on the screen it leads to, not here, so a page full of notices stays calm.
const TONE = {
  critical: "border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-text)]",
  action: "border-[var(--status-action-border)] bg-[var(--status-action-bg)] text-[var(--status-action-text)]",
  pending: "border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] text-[var(--status-pending-text)]",
} as const;

export function NoticeRow({ tone, title, detail, href, action }: { tone: keyof typeof TONE; title: string; detail?: string; href: string; action: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px] ${TONE[tone]}`}>
      <p className="min-w-0">
        <span className="font-medium">{title}</span>
        {detail && <span className="ml-2 text-xs">{detail}</span>}
      </p>
      <Link href={href} className="shrink-0 font-medium underline">
        {action} →
      </Link>
    </div>
  );
}
