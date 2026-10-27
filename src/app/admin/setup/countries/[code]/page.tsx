import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { BackButton } from "@/components/ui/back-button";
import { adminCard, AdminHeader, Facts } from "../../../ui";
import { getCountryPageData } from "../actions";
import { FiscalYearStart } from "./fiscal-year-start";

export default async function AdminCountryPage({ params }: { params: Promise<{ code: string }> }) {
  await requirePlatformAdmin();
  const { code } = await params;
  const data = await getCountryPageData(code.toUpperCase());
  if (!data) notFound();
  const { country, counts } = data;
  const rules = `?country=${country.code}`;
  // Where each part of a country's compliance is set up. The three screens under Compliance Configuration already work
  // for one country at a time, so they open here already pointed at this country.
  const sections = [
    { title: "Company types", count: counts.companyTypes, note: "Private Limited, Sole Proprietorship and so on." },
    { title: "Taxes", count: counts.taxTypes, note: "The tax types, like VAT and Income tax." },
    { title: "Authorities", count: counts.authorities, note: "The tax offices and regulators." },
    { title: "Tax rates", count: counts.taxRates, note: "VAT and TDS rates, by date.", href: `/admin/compliance/tax-rates${rules}` },
    { title: "Deadlines", count: counts.deadlines, note: "What must be filed, and when it is due.", href: `/admin/compliance/templates${rules}` },
    { title: "Fines and penalties", count: counts.penalties, note: "Late filing and late payment figures.", href: `/admin/compliance/penalties${rules}` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton href="/admin/setup/countries" label="Back to countries" />
        <AdminHeader title={country.name} description="Everything the platform sets up for organizations in this country." />
      </div>
      <div className={`${adminCard} space-y-4 p-5`}>
        <Facts items={[["Code", country.code], ["Currency", country.currency], ["Calendar", country.statutoryCalendar], ["Organizations", String(counts.organizations)]]} />
        <FiscalYearStart code={country.code} calendar={country.statutoryCalendar as "AD" | "BS"} month={country.fiscalYearStartMonth} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => {
          const body = (
            <>
              <p className="font-medium text-[var(--text-primary)]">{s.title}</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{s.note}</p>
              <p className={`mt-3 text-xs ${s.count ? "text-[var(--text-secondary)]" : "text-amber-700"}`}>{s.count ? `${s.count} set up` : "Not set up yet"}</p>
            </>
          );
          return s.href ? (
            <Link key={s.title} href={s.href} className={`${adminCard} block p-5 transition-shadow hover:shadow-sm`}>
              {body}
            </Link>
          ) : (
            <div key={s.title} className={`${adminCard} p-5 opacity-60`} title="Coming next">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
