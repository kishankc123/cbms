import Link from "next/link";
import { guardView, guardSalary } from "@/components/page-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { requireTenantSession } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { slabsOn } from "@/lib/compliance/slabs";
import { attentionItems, loadOverview } from "@/lib/payroll/overview";
import { loadLiabilities } from "@/lib/payroll/payroll-report-data";
import { payrollRulesOn } from "@/lib/payroll/platform-rules";
import { payrollTaxContext } from "@/lib/payroll/salary-tax";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; tone: StatusTone }> = { draft: { label: "Draft", tone: "neutral" }, review: { label: "In review", tone: "pending" }, approved: { label: "Approved", tone: "action" }, finalized: { label: "Finalized", tone: "success" } };

// The Payroll home: the latest run's figures, what is owed, recent runs, and anything worth a look before the next run.
export default async function PayrollOverviewPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();
  const today = todayIso();
  const ctx = await payrollTaxContext(session.tenantId, today);
  const [overview, liabilities, slabs, rules] = await Promise.all([
    loadOverview(session.tenantId),
    loadLiabilities(session.tenantId),
    ctx.headKey ? slabsOn(ctx.countryCode, ctx.headKey, today) : Promise.resolve(null),
    ctx.countryCode ? payrollRulesOn(ctx.countryCode, today) : Promise.resolve(null),
  ]);

  const latest = overview.recent[0];
  const owedOf = (prefix: string) => liabilities.filter((l) => l.label.startsWith(prefix)).reduce((s, l) => s + l.amount, 0);
  const salaryOwed = owedOf("Employees");
  const taxOwed = owedOf("Tax office");
  const fundsOwed = liabilities.filter((l) => /^(SSF|PF|CIT):/.test(l.label)).reduce((s, l) => s + l.amount, 0);
  const attention = attentionItems({ activeEmployees: overview.activeEmployees, ...overview.attention, slabsPublished: Boolean(slabs), rulesPublished: Boolean(rules), rulesVerified: rules?.isVerified ?? false });
  const owing = liabilities.filter((l) => Math.abs(l.amount) > 0.004);

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll overview" className="!mb-0" />

      <StatStrip
        items={[
          { label: "Employees", value: overview.activeEmployees },
          { label: latest ? `Gross salary (${latest.label})` : "Gross salary", value: latest ? money(latest.gross) : "—" },
          { label: "Net salary payable", value: money(salaryOwed) },
          { label: latest ? `Employer contributions (${latest.label})` : "Employer contributions", value: latest ? money(latest.employer) : "—" },
          { label: "Tax payable", value: money(taxOwed), tone: taxOwed > 0 ? "warning" : "default" },
        ]}
      />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div>
          <p className="text-xs text-ink-2">Latest payroll run</p>
          {latest ? (
            <p className="mt-0.5 flex items-center gap-2 text-sm text-ink">
              <span className="font-semibold">{latest.label}</span>
              <StatusPill tone={STATUS[latest.status]?.tone ?? "neutral"}>{STATUS[latest.status]?.label ?? latest.status}</StatusPill>
              <span className="text-xs text-ink-2">
                <D value={latest.periodStart} /> – <D value={latest.periodEnd} />
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-ink-2">No payroll has been run yet.</p>
          )}
        </div>
        <div className="flex gap-2">
          {latest && latest.status !== "finalized" && (
            <Link href={`/payroll/salary-sheet/${latest.id}`} className="rounded-md border border-line-strong px-3 py-[5px] text-[13px] text-ink hover:bg-hover">
              Continue this run
            </Link>
          )}
          <Link href="/payroll/salary-sheet" className="rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] hover:bg-accent-hover">
            {latest ? "Payroll processing" : "Run payroll"}
          </Link>
        </div>
      </section>

      {attention.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Needs attention</h2>
          <ul className="space-y-1.5">
            {attention.map((a) => (
              <li key={a.key} className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm ${a.tone === "danger" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
                <span>{a.text}</span>
                <Link href={a.href} className="shrink-0 text-xs underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Outstanding payroll liabilities</h2>
            {fundsOwed > 0 && (
              <Link href="/payroll/contributions" className="text-xs text-accent hover:underline">
                Pay contributions
              </Link>
            )}
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {owing.map((l) => (
                <tr key={l.label} className="border-b border-line">
                  <td className="px-2.5 py-1.5">{l.label}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{money(l.amount)}</td>
                </tr>
              ))}
              {owing.length === 0 && (
                <tr>
                  <td className="px-2.5 py-4 text-center text-ink-3">Nothing is owed. All payroll liabilities are paid.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Recent payroll runs</h2>
            <Link href="/payroll/reports" className="text-xs text-accent hover:underline">
              Reports
            </Link>
          </div>
          <table className="w-full border-collapse text-[13px]">
            <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Period</th>
                <th className="px-2.5 py-1.5 font-medium">Status</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Gross</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {overview.recent.map((r) => (
                <tr key={r.id} className="border-b border-line transition-colors hover:bg-hover">
                  <td className="px-2.5 py-1.5">
                    <Link href={`/payroll/salary-sheet/${r.id}`} className="text-accent hover:underline">
                      {r.label}
                    </Link>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <StatusPill tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</StatusPill>
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{money(r.gross)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{money(r.net)}</td>
                </tr>
              ))}
              {overview.recent.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2.5 py-4 text-center text-ink-3">
                    No payroll runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
