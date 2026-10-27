import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { BackButton } from "@/components/ui/back-button";
import { monthNames } from "@/lib/calendar";
import { categoriesOf, COMPLIANCE_TABS, complianceTab, STATUTORY_PENALTIES } from "@/lib/compliance/config-tabs";
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

export default async function AdminCountryCompliancePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requirePlatformAdmin();
  const code = (await params).code.toUpperCase();
  const tab = complianceTab((await searchParams).tab);
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

      {tab === "tax" && <TaxTab code={code} />}

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

// One card group per tax: its rates, its fines and its deadlines, each shown only where the tax has them. The taxes themselves
// come from the country's Taxes list, so adding a tax there adds its deadlines here.
async function TaxTab({ code }: { code: string }) {
  const [taxes, rates, penalties, templates] = await Promise.all([listSetup(code, "taxes"), getTaxRateAdminData(code), getPenaltyAdminData(code), getTemplateAdminData(code)]);
  const rateKeys: string[] = PUBLISHABLE_TAX_TYPES.map((t) => t.key);
  const penaltyKeys = PENALTY_TYPES.map((t) => t.key).filter((k) => !(STATUTORY_PENALTIES as readonly string[]).includes(k));
  const taxCategories = categoriesOf("tax");
  const shown = taxes.rows.filter((t) => t.isActive);
  const shownKeys = shown.map((t) => t.key);
  return (
    <div className="space-y-8">
      {shown.map((t) => (
        <section key={t.key} className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{t.name}</h2>
          {rateKeys.includes(t.key) && <TaxRatesAdmin data={rates} only={[t.key as (typeof PUBLISHABLE_TAX_TYPES)[number]["key"]]} organizations={false} />}
          {(penaltyKeys as string[]).includes(t.key) && <PenaltiesAdmin data={penalties} only={[t.key as (typeof PENALTY_TYPES)[number]["key"]]} />}
          <TemplatesAdmin data={templates} categoryKeys={taxCategories} taxKey={t.key} addable />
        </section>
      ))}
      <TemplatesAdmin data={templates} categoryKeys={taxCategories} exceptTaxKeys={shownKeys} />
      <TaxRatesAdmin data={rates} only={[]} />
      {shown.length === 0 && <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No taxes are set up yet. Add them under Setup → Countries.</p>}
    </div>
  );
}
