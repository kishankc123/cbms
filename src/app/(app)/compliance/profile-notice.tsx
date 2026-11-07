import { requireTenantSession } from "@/lib/session";
import { loadComplianceProfile } from "@/lib/compliance/profile";
import { NoticeRow } from "./notice-row";

// Shown until the company profile is complete: compliance does not start before then, because a deadline worked out from missing facts would be a
// guess. One line here; Company Details shows what is missing.
export async function ComplianceProfileNotice() {
  const session = await requireTenantSession();
  const profile = await loadComplianceProfile(session.tenantId);
  if (profile.complete) return null;
  const n = profile.gaps.length;
  return <NoticeRow tone="action" title="Complete your company details to start compliance" detail={`${n} detail${n === 1 ? "" : "s"} missing, starting with ${profile.gaps[0]?.label ?? "the company type"}`} href="/compliance/company" action="Complete" />;
}
