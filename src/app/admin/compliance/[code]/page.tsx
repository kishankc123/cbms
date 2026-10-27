import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { BackButton } from "@/components/ui/back-button";
import { monthNames } from "@/lib/calendar";
import { categoriesOf, COMPLIANCE_TABS, complianceTab, NOT_TAXES, STATUTORY_PENALTIES } from "@/lib/compliance/config-tabs";
import { PENALTY_TYPES } from "@/lib/compliance/penalty-types";
import { PUBLISHABLE_TAX_TYPES } from "@/lib/compliance/platform-tax-rate-types";
import { listSetup } from "@/lib/country-setup";
import { getCountryPageData } from "@/app/admin/setup/countries/actions";
import { adminCard, AdminHeader, Facts } from "../../ui";
import { getTaxRateAdminData } from "../tax-rates/actions";
import { TaxRatesAdmin } from "../tax-rates/tax-rates-admin";
import { getPenaltyAdminData } from "../penalties/actions";
import { PenaltiesAdmin } from "../penalties/penalties-admin";
import { getTemplateAdminData } from "../templates/actions";
import { TemplatesAdmin } from "../templates/templates-admin";

export default async function AdminCountryCompliancePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string; tax?: string; view?: string }> }) {
  await requirePlatformAdmin();
  const code = (await params).code.toUpperCase();
  const query = await searchParams;
  const tab = complianceTab(query.tab);
  const summary = await getCountryPageData(code);
  if (!summary) notFound();
  const { country, counts } = summary;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton href="/admin/compliance" label="Back to countries" />
        <AdminHeader title={country.name} description="Taxes, filings and fines for every organization in this country." />
      </div>
      <nav className="flex gap-1 border-b border-[var(--card-border)]">
        {COMPLIANCE_TABS.map((t) => (
          <Link key={t.key} href={`/admin/compliance/${code}?tab=${t.key}`} className={`px-4 py-2 text-sm ${tab === t.key ? "border-b-2 border-[var(--color-primary)] font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className={`${adminCard} p-5`}>
            <Facts items={[["Currency", country.currency], ["Calendar", country.statutoryCalendar], ["Fiscal year starts", monthNames(country.statutoryCalendar as "AD" | "BS")[country.fiscalYearStartMonth - 1]], ["Organizations", String(counts.organizations)]]} />
          </div>
          <div className={`${adminCard} divide-y divide-[var(--card-border)]`}>
            {[
              ["Company types", counts.companyTypes, "company-types"],
              ["Taxes", counts.taxTypes, "taxes"],
              ["Authorities", counts.authorities, "authorities"],
            ].map(([label, n, section]) => (
              <Link key={String(label)} href={`/admin/setup/countries/${code}/${section}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-[var(--surface-muted-bg)]">
                <span className="text-[var(--text-primary)]">{label}</span>
                <span className={n ? "text-[var(--text-secondary)]" : "text-amber-700"}>{n ? `${n} set up` : "Not set up yet"}</span>
              </Link>
            ))}
            <div className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="text-[var(--text-primary)]">Published tax rates · Deadlines · Fines and penalties</span>
              <span className="text-[var(--text-secondary)]">
                {counts.taxRates} · {counts.deadlines} · {counts.penalties}
              </span>
            </div>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Company types, taxes and authorities are set up under{" "}
            <Link href={`/admin/setup/countries/${code}`} className="text-[var(--color-primary)] hover:underline">
              Setup → Countries → {country.name}
            </Link>
            .
          </p>
        </div>
      )}

      {tab === "tax" && <TaxTab code={code} tax={query.tax} view={query.view === "penalties" ? "penalties" : "basic"} />}

      {tab === "statutory" && (
        <div className="space-y-4">
          <TemplatesAdmin data={await getTemplateAdminData(code)} categoryKeys={categoriesOf("statutory")} addable />
          <PenaltiesAdmin data={await getPenaltyAdminData(code)} only={STATUTORY_PENALTIES} />
        </div>
      )}

      {tab === "local" && <TemplatesAdmin data={await getTemplateAdminData(code)} categoryKeys={categoriesOf("local")} addable />}
    </div>
  );
}

// One tax at a time: pick the tax, then Basic (its rate, how it is filed and its deadlines) or Penalties & fines. The taxes come from
// the country's Taxes list, so a tax added there appears here. The choice lives in the address, so each view can be bookmarked.
async function TaxTab({ code, tax, view }: { code: string; tax?: string; view: "basic" | "penalties" }) {
  const [taxes, rates, penalties, templates] = await Promise.all([listSetup(code, "taxes"), getTaxRateAdminData(code), getPenaltyAdminData(code), getTemplateAdminData(code)]);
  // The taxes that have a rate come first, in their usual order (VAT, TDS, Income tax); the rest follow by name.
  const rank = (key: string) => PUBLISHABLE_TAX_TYPES.findIndex((t) => t.key === key) + 1 || 99;
  const list = taxes.rows.filter((t) => t.isActive && !(NOT_TAXES as readonly string[]).includes(t.key)).sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
  const selected = list.find((t) => t.key === tax) ?? list[0];
  if (!selected) return <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No taxes are set up yet. Add them under Setup → Countries.</p>;
  const link = (key: string, v: string) => `/admin/compliance/${code}?tab=tax&tax=${key}&view=${v}`;
  const hasRate = PUBLISHABLE_TAX_TYPES.some((t) => t.key === selected.key);
  const hasPenalties = PENALTY_TYPES.some((t) => t.key === selected.key && !(STATUTORY_PENALTIES as readonly string[]).includes(t.key));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {list.map((t) => (
          <Link key={t.key} href={link(t.key, view)} className={`rounded-full px-4 py-1.5 text-sm ${t.key === selected.key ? "bg-[var(--color-primary)] text-white" : "bg-[var(--surface-muted-bg)] text-[var(--text-secondary)]"}`}>
            {t.name}
          </Link>
        ))}
      </div>
      <div className="flex gap-1 border-b border-[var(--card-border)]">
        {([["basic", "Basic"], ["penalties", "Penalties & fines"]] as const).map(([v, label]) => (
          <Link key={v} href={link(selected.key, v)} className={`px-4 py-2 text-sm ${view === v ? "border-b-2 border-[var(--color-primary)] font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
            {label}
          </Link>
        ))}
      </div>

      {view === "basic" ? (
        <div className="space-y-6">
          {hasRate && <TaxRatesAdmin data={rates} only={[selected.key as (typeof PUBLISHABLE_TAX_TYPES)[number]["key"]]} />}
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Filing and deadlines</h2>
            <p className="text-sm text-[var(--text-secondary)]">How {selected.name} is filed (for example monthly or quarterly) and when each return or payment is due. Switch one off with Edit → Active.</p>
            <TemplatesAdmin data={templates} categoryKeys={categoriesOf("tax")} taxKey={selected.key} addable />
          </section>
        </div>
      ) : hasPenalties ? (
        <PenaltiesAdmin data={penalties} only={[selected.key as (typeof PENALTY_TYPES)[number]["key"]]} />
      ) : (
        <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No fines are set up for {selected.name} yet.</p>
      )}
    </div>
  );
}
