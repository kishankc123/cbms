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
  // Where each part of a country is set up. Rates, filings and fines live in Compliance Configuration, one page per country.
  const sections = [
    { title: "Company types", count: counts.companyTypes, note: "Private Limited, Sole Proprietorship and so on.", href: `/admin/setup/countries/${country.code}/company-types` },
    { title: "Taxes", count: counts.taxTypes, note: "The tax types, like VAT and Income tax.", href: `/admin/setup/countries/${country.code}/taxes` },
    { title: "Authorities", count: counts.authorities, note: "The tax offices and regulators.", href: `/admin/setup/countries/${country.code}/authorities` },
    { title: "TDS headings", count: counts.tdsHeadings, note: "Payroll, Rent, Services and so on. Each has its own rate.", href: `/admin/setup/countries/${country.code}/tds-headings` },
    { title: "Compliance setup", count: counts.taxRates + counts.deadlines + counts.penalties, note: "Tax rates, deadlines, fines and penalties.", href: `/admin/compliance/${country.code}` },
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
          return (
            <Link key={s.title} href={s.href} className={`${adminCard} block p-5 transition-shadow hover:shadow-sm`}>
              {body}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
