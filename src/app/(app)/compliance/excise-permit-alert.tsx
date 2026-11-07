import { requireTenantSession } from "@/lib/session";
import { loadPermit } from "@/lib/compliance/excise-permit";
import { NoticeRow } from "./notice-row";

// A slim notice while the excise permit needs renewing, or has lapsed. The cost, the late fine and what it means for excisable goods are shown
// in Tax Compliance > Excise, where the renewal is made, not here.
export async function ExcisePermitAlert() {
  const session = await requireTenantSession();
  const permit = await loadPermit(session.tenantId);
  if (!permit || permit.status.state === "active") return null;
  const s = permit.status;
  const late = s.state === "expired";
  const title = s.cancelled ? "Excise permit cancelled: operating without a licence" : late ? "Excise permit expired" : "Excise permit renewal is due now";
  const detail = late || s.cancelled ? `Renewal for ${s.renewalFor.label} is ${s.monthsLate} month${s.monthsLate === 1 ? "" : "s"} late` : `Renewal for ${s.renewalFor.label}`;
  return <NoticeRow tone={late || s.cancelled ? "critical" : "action"} title={title} detail={detail} href="/compliance/tax?tab=excise" action="Renew" />;
}
