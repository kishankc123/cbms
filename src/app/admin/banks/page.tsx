import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { listInstitutions } from "@/lib/banking/institutions";
import { AdminHeader } from "../ui";
import { BanksAdmin } from "./banks-admin";

export default async function BanksPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  await requirePlatformAdmin();
  const countries = await db.select({ code: complianceCountries.code, name: complianceCountries.name }).from(complianceCountries).where(eq(complianceCountries.isActive, true)).orderBy(asc(complianceCountries.name));
  const code = (await searchParams).country ?? countries[0]?.code;
  const list = code ? await listInstitutions(code, false) : [];
  return (
    <div className="space-y-4">
      <AdminHeader title="Banks and wallets" description="The banks and wallets organizations pick from when they add an account. A logo is optional: without one, the initials are shown." />
      {code ? <BanksAdmin key={code} countryCode={code} countries={countries} list={list} /> : <p className="text-sm text-gray-500">No country is set up yet.</p>}
    </div>
  );
}
