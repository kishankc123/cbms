import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { loadPermit } from "@/lib/compliance/excise-permit";
import { permitMessage } from "@/lib/compliance/excise-permit-rules";

// A banner on the compliance pages while the excise permit needs renewing, or has lapsed. In penalty mode it says plainly that
// excisable goods must not be removed or sold until the permit is renewed, and past the last band that the business is
// operating without a licence.
export async function ExcisePermitAlert() {
  const session = await requireTenantSession();
  const permit = await loadPermit(session.tenantId);
  if (!permit || permit.status.state === "active") return null;
  const s = permit.status;
  const late = s.state === "expired";
  return (
    <div className={`rounded-lg border p-4 text-sm ${late ? "border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-text)]" : "border-[var(--status-action-border)] bg-[var(--status-action-bg)] text-[var(--status-action-text)]"}`}>
      <p className="font-medium">{s.cancelled ? "Excise permit cancelled: operating without a licence" : late ? "Excise permit expired: renewal is late" : "Excise permit: renewal due now"}</p>
      <p className="mt-0.5">{permitMessage(s)}</p>
      <Link href="/compliance/tax" className="mt-1 inline-block underline">
        Open Tax Compliance &gt; Excise to renew
      </Link>
    </div>
  );
}
