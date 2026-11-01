import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { BackButton } from "@/components/ui/back-button";
import { monthNames } from "@/lib/calendar";
import { categoriesOf, COMPLIANCE_TABS, complianceTab, NOT_TAXES, STATUTORY_PENALTIES } from "@/lib/compliance/config-tabs";
import { PENALTY_TYPES } from "@/lib/compliance/penalty-types";
import { BASE_RATE_TYPES, headRateKey } from "@/lib/compliance/platform-tax-rate-types";
import { listSetup } from "@/lib/country-setup";
import { getCountryPageData } from "@/app/admin/setup/countries/actions";
import { adminCard, AdminHeader, Facts } from "../../ui";
import { getTaxRateAdminData } from "../tax-rates/actions";
import { TaxRatesAdmin } from "../tax-rates/tax-rates-admin";
import { SlabsAdmin } from "../tax-rates/slabs-admin";
import { FiscalYearFilter } from "./fiscal-year-filter";
import { ModulesAdmin } from "../modules/modules-admin";
import { listModuleTaxes } from "@/lib/compliance/module-tax-admin";
import { TAX_MODULES } from "@/lib/compliance/module-taxes";
import { getPenaltyAdminData } from "../penalties/actions";
import { PenaltiesAdmin } from "../penalties/penalties-admin";
import { getTemplateAdminData } from "../templates/actions";
import { TemplatesAdmin } from "../templates/templates-admin";

export default async function AdminCountryCompliancePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string; tax?: string; head?: string; view?: string; fy?: string; module?: string }> }) {
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

      {tab === "tax" && <TaxTab code={code} tax={query.tax} head={query.head} fy={query.fy} view={query.view === "penalties" ? "penalties" : "setup"} />}

      {tab === "modules" && <ModulesTab code={code} countryName={country.name} module={query.module} />}

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

// Which taxes apply in which module of the country, and how: pick the module, then see and edit its taxes. The rates stay in Tax & rates.
async function ModulesTab({ code, countryName, module }: { code: string; countryName: string; module?: string }) {
  const data = await listModuleTaxes(code);
  const selected = TAX_MODULES.find((m) => m.key === module)?.key ?? TAX_MODULES[0].key;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TAX_MODULES.map((m) => (
          <Link key={m.key} href={`/admin/compliance/${code}?tab=modules&module=${m.key}`} className={`rounded-full px-4 py-1.5 text-sm ${m.key === selected ? "bg-[var(--color-primary)] text-white" : "bg-[var(--surface-muted-bg)] text-[var(--text-secondary)]"}`}>
            {m.label}
          </Link>
        ))}
      </div>
      <ModulesAdmin key={selected} countryCode={code} countryName={countryName} moduleKey={selected} data={data} />
    </div>
  );
}

// One tax at a time: pick the tax, then Setup (its rate, how it is filed and its deadlines) or Penalty & fines. TDS is not one rate: it is
// split into headings (Payroll, Rent, Services...), each with a rate of its own, so a heading is picked first. The taxes and headings come
// from the country's setup lists, so one added there appears here. The choice lives in the address, so each view can be bookmarked.
async function TaxTab({ code, tax, head, fy, view }: { code: string; tax?: string; head?: string; fy?: string; view: "setup" | "penalties" }) {
  const [taxes, rates, penalties, templates, headRows] = await Promise.all([listSetup(code, "taxes"), getTaxRateAdminData(code), getPenaltyAdminData(code), getTemplateAdminData(code), listSetup(code, "tds-headings")]);
  // The taxes that have a rate come first, in their usual order (VAT, TDS, Income tax); the rest follow by name.
  const order = ["vat", "tds", "income_tax"];
  const rank = (key: string) => order.indexOf(key) + 1 || 99;
  const list = taxes.rows.filter((t) => t.isActive && !(NOT_TAXES as readonly string[]).includes(t.key)).sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
  const selected = list.find((t) => t.key === tax) ?? list[0];
  if (!selected) return <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No taxes are set up yet. Add them under Setup → Countries.</p>;

  const hasHeads = selected.key === "tds";
  const heads = headRows.rows.filter((h) => h.isActive);
  const selectedHead = hasHeads ? heads.find((h) => h.key === head) ?? heads[0] : undefined;
  const years = rates.years;
  const currentYear = years.find((y) => y.from <= rates.today && rates.today <= y.to) ?? years[0];
  const fiscalYear = years.find((y) => String(y.startYear) === fy) ?? currentYear;
  const link = (key: string, headKey: string | undefined, v: string, year = fiscalYear?.startYear) => `/admin/compliance/${code}?tab=tax&tax=${key}${headKey ? `&head=${headKey}` : ""}&view=${v}${year ? `&fy=${year}` : ""}`;
  const hasRate = BASE_RATE_TYPES.some((t) => t.key === selected.key);
  const hasPenalties = PENALTY_TYPES.some((t) => t.key === selected.key && !(STATUTORY_PENALTIES as readonly string[]).includes(t.key));
  const pill = (active: boolean) => `rounded-full px-4 py-1.5 text-sm ${active ? "bg-[var(--color-primary)] text-white" : "bg-[var(--surface-muted-bg)] text-[var(--text-secondary)]"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {list.map((t) => (
          <Link key={t.key} href={link(t.key, undefined, view)} className={pill(t.key === selected.key)}>
            {t.name}
          </Link>
        ))}
      </div>
      {hasHeads && (
        <div className="flex flex-wrap items-center gap-2">
          {heads.map((h) => (
            <Link key={h.key} href={link("tds", h.key, view)} className={pill(h.key === selectedHead?.key)}>
              {h.name}
            </Link>
          ))}
          <Link href={`/admin/setup/countries/${code}/tds-headings`} className="ml-2 text-sm text-[var(--color-primary)] hover:underline">
            Manage headings
          </Link>
        </div>
      )}
      <div className="flex items-end justify-between gap-3 border-b border-[var(--card-border)]">
        <div className="flex gap-1">
          {([["setup", "Setup"], ["penalties", "Penalty & fines"]] as const).map(([v, label]) => (
            <Link key={v} href={link(selected.key, selectedHead?.key, v)} className={`px-4 py-2 text-sm ${view === v ? "border-b-2 border-[var(--color-primary)] font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              {label}
            </Link>
          ))}
        </div>
        {fiscalYear && (
          <div className="pb-1.5">
            <FiscalYearFilter
              years={years.map((y) => ({ startYear: y.startYear, label: y.label, toConfirm: rates.drafts.filter((d) => d.effectiveFrom === y.from).length }))}
              selected={fiscalYear.startYear}
              hrefFor={Object.fromEntries(years.map((y) => [y.startYear, link(selected.key, selectedHead?.key, view, y.startYear)]))}
            />
          </div>
        )}
      </div>

      {view === "setup" ? (
        <div className="space-y-6">
          {hasHeads && !selectedHead && <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No TDS headings yet. Add them under Manage headings.</p>}
          {selectedHead && (
            <>
              {selectedHead.kind === "slabs" ? (
                fiscalYear && <SlabsAdmin data={rates} headKey={selectedHead.key} headName={selectedHead.name} fiscalYear={fiscalYear} />
              ) : (
                <TaxRatesAdmin data={rates} only={[headRateKey("tds", selectedHead.key)]} fiscalYear={fiscalYear} />
              )}
              <p className="text-sm text-[var(--text-secondary)]">
                Used in: <span className="text-[var(--text-primary)]">{selectedHead.module === "payroll" ? "Payroll (salary sheet and payslip)" : "Expenses"}</span>
              </p>
            </>
          )}
          {hasRate && <TaxRatesAdmin data={rates} only={[selected.key]} fiscalYear={fiscalYear} />}
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{hasHeads ? "TDS filing and deadlines (all headings)" : "Filing and deadlines"}</h2>
            <p className="text-sm text-[var(--text-secondary)]">How {selected.name} is filed (for example monthly or quarterly) and when each return or payment is due. Switch one off with Edit → Active.</p>
            <TemplatesAdmin data={templates} categoryKeys={categoriesOf("tax")} taxKey={selected.key} addable />
          </section>
        </div>
      ) : hasPenalties ? (
        <div className="space-y-3">
          {hasHeads && <p className="rounded bg-[var(--surface-muted-bg)] px-4 py-2 text-sm text-[var(--text-secondary)]">These fines apply to all TDS headings. Changing them here changes them for every heading.</p>}
          <PenaltiesAdmin data={penalties} only={[selected.key as (typeof PENALTY_TYPES)[number]["key"]]} fiscalYear={fiscalYear} />
        </div>
      ) : (
        <p className={`${adminCard} p-5 text-sm text-[var(--text-secondary)]`}>No fines are set up for {selected.name} yet.</p>
      )}
    </div>
  );
}
