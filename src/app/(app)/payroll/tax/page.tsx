import { guardView, guardSalary } from "@/components/page-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { requireTenantSession } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { slabsOn } from "@/lib/compliance/slabs";
import { payrollTaxContext } from "@/lib/payroll/salary-tax";
import { payrollRulesOn } from "@/lib/payroll/platform-rules";
import { TAXPAYER_CLASSES, type Slab } from "@/lib/compliance/slab-tables";
import { SCHEME_KEYS } from "@/lib/payroll/retirement-rules";

const money = (n: number) => n.toLocaleString("en-IN");

function SlabTable({ label, slabs }: { label: string; slabs: Slab[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-2">{label}</p>
      <table className="w-full border-collapse text-[13px]">
        <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Annual income from</th>
            <th className="px-2.5 py-1.5 font-medium">Up to</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {slabs.map((s, i) => (
            <tr key={i} className="border-b border-line">
              <td className="px-2.5 py-1.5 tabular-nums">{money(i === 0 ? 0 : (slabs[i - 1].upTo ?? 0))}</td>
              <td className="px-2.5 py-1.5 tabular-nums">{s.upTo === null ? "and above" : money(s.upTo)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{s.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The tax and contribution rules payroll is using today. They are set for the whole country by the platform administrator, so this page is read
// only: it is here so anyone can see exactly which rates a payroll run applied, and whether they have been confirmed against current law.
export default async function PayrollTaxConfigurationPage() {
  const denied = (await guardView("payroll")) ?? (await guardSalary());
  if (denied) return denied;
  const session = await requireTenantSession();
  const today = todayIso();
  const ctx = await payrollTaxContext(session.tenantId, today);
  const [slabs, rules] = await Promise.all([ctx.headKey ? slabsOn(ctx.countryCode, ctx.headKey, today) : Promise.resolve(null), ctx.countryCode ? payrollRulesOn(ctx.countryCode, today) : Promise.resolve(null)]);

  return (
    <div className="space-y-8">
      <PageHeader title="Tax configuration" className="!mb-0" />
      <p className="text-sm text-ink-2">These rates are published for your whole country and apply from the date shown. They can&apos;t be changed here. A new version applies from its start date and never changes payroll that has already been finalized.</p>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">Remuneration tax slabs</h2>
          {slabs && <StatusPill tone="neutral">{slabs.label}</StatusPill>}
          {ctx.fy && <span className="text-xs text-ink-2">Fiscal year {ctx.fy.label}</span>}
        </div>
        {slabs ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {TAXPAYER_CLASSES.map(({ key, label }) => (
              <SlabTable key={key} label={label} slabs={slabs.tables[key]} />
            ))}
          </div>
        ) : (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">No salary tax slabs are published for your country for today, so payroll takes no remuneration tax. Ask your platform administrator to publish them.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">Retirement contributions and tax limits</h2>
          {rules && (rules.isVerified ? <StatusPill tone="success">Verified</StatusPill> : <StatusPill tone="pending">Not verified yet</StatusPill>)}
        </div>
        {rules ? (
          <>
            {!rules.isVerified && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">These rates have not been confirmed against current law yet. Check them before relying on payroll that uses them.</p>}
            <div className="grid gap-6 lg:grid-cols-2">
              {SCHEME_KEYS.map((k) => (
                <div key={k}>
                  <p className="mb-1 text-xs font-medium text-ink-2">{rules.rules.schemes[k].label}</p>
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="text-left text-xs text-ink-2 [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
                      <tr>
                        <th className="px-2.5 py-1.5 font-medium">Contribution</th>
                        <th className="px-2.5 py-1.5 text-right font-medium">Employee</th>
                        <th className="px-2.5 py-1.5 text-right font-medium">Employer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.rules.schemes[k].lines.map((l) => (
                        <tr key={l.key} className="border-b border-line">
                          <td className="px-2.5 py-1.5">{l.label}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">{l.employeePct}%</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">{l.employerPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-ink-2">
                    On basic salary{rules.rules.schemes[k].monthlyBasisCap !== null ? ` up to ${money(rules.rules.schemes[k].monthlyBasisCap!)} a month` : ""}. {rules.rules.schemes[k].sstExemptionPossible ? "Can qualify an employee for the first-band exemption." : "No first-band exemption."}
                  </p>
                </div>
              ))}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
              <li>
                Retirement savings reduce taxable income by the least of the actual amount, {rules.rules.retirementDeduction.incomeShare.num}/{rules.rules.retirementDeduction.incomeShare.den} of assessable income and {money(rules.rules.retirementDeduction.annualCap)} a year.
              </li>
              <li>
                CIT has no fixed rate: each employee chooses their own contribution
                {rules.rules.cit.monthlyCeiling !== null ? `, up to ${money(rules.rules.cit.monthlyCeiling)} a month` : ""}. {rules.rules.cit.employerContributionAllowed ? "The employer may add to it." : "The employer may not add to it."}
              </li>
              <li>The first-band exemption waives the lowest {rules.rules.sst.exemptBands} slab{rules.rules.sst.exemptBands === 1 ? "" : "s"} for an employee confirmed as eligible. Being in SSF does not decide that on its own.</li>
            </ul>
          </>
        ) : (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">No payroll rules are published for your country for <D value={today} />, so retirement contributions can&apos;t be worked out. Ask your platform administrator to publish them.</p>
        )}
      </section>
    </div>
  );
}
