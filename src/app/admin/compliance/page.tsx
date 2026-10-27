import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { StatusPill } from "@/components/ui/status-pill";
import { complianceReadiness, countriesWithUsage } from "@/lib/countries";
import { adminCard, AdminHeader } from "../ui";

export default async function AdminCompliancePage() {
  await requirePlatformAdmin();
  const [countries, ready] = await Promise.all([countriesWithUsage(), complianceReadiness()]);
  const active = countries.filter((c) => c.isActive);
  const parts = [["Tax & rates", "tax"], ["Statutory", "statutory"], ["Local compliance", "local"]] as const;
  return (
    <div className="space-y-5">
      <AdminHeader title="Compliance Configuration" description="What the platform tells every organization about its compliance duties, country by country. Past periods keep the rules that applied then." />
      <div className={`${adminCard} divide-y divide-[var(--card-border)]`}>
        {active.map((c) => (
          <Link key={c.code} href={`/admin/compliance/${c.code}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-[var(--surface-muted-bg)]">
            <div>
              <p className="font-medium text-[var(--text-primary)]">{c.name}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {c.currency} · {c.organizations} organization{c.organizations === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {parts.map(([label, key]) => (
                <StatusPill key={key} tone={ready[c.code]?.[key] ? "success" : "action"}>
                  {label}: {ready[c.code]?.[key] ? "set up" : "not yet"}
                </StatusPill>
              ))}
            </div>
          </Link>
        ))}
        {active.length === 0 && <p className="px-5 py-6 text-center text-sm text-[var(--text-secondary)]">No countries yet. Add one under Setup → Countries.</p>}
      </div>
    </div>
  );
}
