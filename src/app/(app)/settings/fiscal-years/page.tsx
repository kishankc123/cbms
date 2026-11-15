import Link from "next/link";
import { isOrgAdmin } from "@/lib/roles";
import { requireTenantSession } from "@/lib/session";
import { formatDate } from "@/lib/calendar";
import { getBooksStart } from "@/lib/ledger/books-start";
import { settingsCard } from "../ui";
import { getFiscalYearsPageData } from "./actions";
import { FiscalYearsManager } from "./fiscal-years-manager";
import { PageHeader } from "@/components/ui/page-header";

export default async function FiscalYearsPage() {
  const session = await requireTenantSession();
  const [data, booksStart] = await Promise.all([getFiscalYearsPageData(), getBooksStart(session.tenantId)]);

  return (
    <div className="space-y-6">
      <PageHeader title="Fiscal Years" description="Every fiscal year on record, its status, and the reporting/posting boundaries it defines." />
      <FiscalYearsManager data={data} isAdmin={isOrgAdmin(session.role)} />

      {/* There is one books start date, and it is set where the opening balances are: this only shows it. */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">Books start date</h2>
        <div className={settingsCard}>
          <p className="text-sm font-medium text-[var(--text-primary)]">{booksStart.date ? formatDate(booksStart.date, session.calendar, "long") : "Not set yet"}</p>
          <p className="mt-1 text-xs text-gray-500">
            Your books begin on this date: the opening balances are posted on it, nothing can be dated before it, and reports start from it. It is set in{" "}
            <Link href="/settings/opening-balances" className="underline">
              Settings &gt; Opening balances
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
