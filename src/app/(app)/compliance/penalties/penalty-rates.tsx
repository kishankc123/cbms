import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { currentPenaltyRates } from "@/lib/compliance/penalty-admin";
import { summarize } from "@/lib/compliance/penalty-types";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";

// The fine and penalty figures the platform has set for this organization's country, read-only. They are what the calculator
// below and the VAT worksheet use, so a person can see exactly which figures a late return is judged by.
export async function PenaltyRates() {
  const session = await requireTenantSession();
  const [tenant] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) return null;
  const rates = await currentPenaltyRates(tenant.countryCode);
  if (rates.every((r) => !r.current)) return null;

  return (
    <section className="space-y-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
      <div>
        <h2 className="text-lg font-medium text-[var(--text-primary)]">Rates in force</h2>
        <p className="text-sm text-[var(--text-secondary)]">Set by the platform for your country. These are the figures late returns and payments are judged by.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {rates.map((r) => (
          <div key={r.key} className="space-y-2 rounded border border-[var(--card-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-[var(--text-primary)]">{r.label}</p>
              {r.current && <StatusPill tone={r.current.isVerified ? "success" : "action"}>{r.current.isVerified ? "Verified" : "Not verified"}</StatusPill>}
            </div>
            {r.current ? (
              <>
                <p className="text-xs text-[var(--text-secondary)]">
                  {r.current.fiscalYear ? `From FY ${r.current.fiscalYear}` : "Original figures"} (<D value={r.current.effectiveFrom} />){r.current.source ? ` · ${r.current.source}` : ""}
                </p>
                <ul className="space-y-0.5 text-sm text-[var(--text-secondary)]">
                  {summarize(r.key, r.current.params).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {!r.current.isVerified && <p className="text-xs text-[var(--status-action-text)]">These figures have not been verified against current law. Confirm them with the Inland Revenue Office before relying on them.</p>}
                {r.upcoming.length > 0 && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Next change: FY {r.upcoming[0].fiscalYear ?? ""} (<D value={r.upcoming[0].effectiveFrom} />)
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">No figures set yet.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
