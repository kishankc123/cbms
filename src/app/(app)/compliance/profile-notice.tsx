import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { loadComplianceProfile } from "@/lib/compliance/profile";

// Shown on the compliance pages until the company profile is complete: compliance does not start before then, because a
// deadline worked out from missing facts would be a guess.
export async function ComplianceProfileNotice() {
  const session = await requireTenantSession();
  const profile = await loadComplianceProfile(session.tenantId);
  if (profile.complete) return null;
  return (
    <div className="rounded-lg border border-[var(--status-action-border)] bg-[var(--status-action-bg)] p-4 text-sm text-[var(--status-action-text)]">
      <p className="font-medium">Complete your company details to start compliance</p>
      <p className="mt-0.5">No returns, permits or deadlines are created until these are filled in:</p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        {profile.gaps.map((g) => (
          <li key={g.key}>
            {g.label}{" "}
            <Link href="/compliance/company" className="underline">
              {g.where === "company" ? "(Company Details)" : "(Company Details > Registrations)"}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
