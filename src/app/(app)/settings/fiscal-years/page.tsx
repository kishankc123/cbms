import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { getFiscalYearsPageData } from "./actions";
import { FiscalYearsManager } from "./fiscal-years-manager";

export default async function FiscalYearsPage() {
  const session = await requireTenantSession();
  const data = await getFiscalYearsPageData();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Fiscal Years</h1>
        <p className="mt-0.5 text-sm text-gray-500">Every fiscal year on record, its status, and the reporting/posting boundaries it defines.</p>
      </div>
      <FiscalYearsManager data={data} isAdmin={isOrgAdmin(session.role)} />
    </div>
  );
}
