import { requireTenantSession } from "@/lib/session";
import { loadCatchup } from "@/lib/compliance/catchup";
import { NoticeRow } from "./notice-row";

// Shown until the checklist of what was already filed has been answered. The explanation is on the checklist itself.
export async function CatchupPrompt() {
  const session = await requireTenantSession();
  const view = await loadCatchup(session.tenantId);
  if (!view.ready || view.unanswered === 0) return null;
  return <NoticeRow tone="pending" title="Tell us what is already filed" detail="Until then only this fiscal year is tracked" href="/compliance/catch-up" action="Open checklist" />;
}
