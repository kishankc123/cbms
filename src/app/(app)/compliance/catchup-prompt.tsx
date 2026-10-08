import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { loadCatchup } from "@/lib/compliance/catchup";

// Shown on the compliance pages until the checklist of what was already filed has been answered.
export async function CatchupPrompt() {
  const session = await requireTenantSession();
  const view = await loadCatchup(session.tenantId);
  if (!view.ready || view.unanswered === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--status-pending-border)] bg-[var(--status-pending-bg)] p-4 text-sm text-[var(--status-pending-text)]">
      <p className="font-medium">Tell us what is already filed</p>
      <p className="mt-0.5">
        Until you do, only the current fiscal year is shown, and earlier returns are not tracked. Say how far income tax, VAT, TDS and the excise permit are up to date and we will mark those periods as filed and keep the rest on your checklist.
      </p>
      <Link href="/compliance/catch-up" className="mt-1 inline-block underline">
        Open the compliance checklist
      </Link>
    </div>
  );
}
