import { requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { DateField } from "@/components/calendar/date-picker";
import { generateFiscalYearOptions } from "@/lib/nepali-fiscal-year";
import { can } from "@/lib/session";
import { updateFiscalYearDates } from "../actions";
import { settingsButton, settingsCard, settingsInput, settingsLabel } from "../ui";
import { getFiscalYearsPageData } from "./actions";
import { FiscalYearsManager } from "./fiscal-years-manager";

const FISCAL_YEARS = generateFiscalYearOptions();

export default async function FiscalYearsPage() {
  const session = await requireTenantSession();
  const data = await getFiscalYearsPageData();
  const canEdit = can(session, "settings", "edit");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Fiscal Years</h1>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">Every fiscal year on record, its status, and the reporting/posting boundaries it defines.</p>
      </div>
      <FiscalYearsManager data={data} isAdmin={isOrgAdmin(session.role)} />

      {tenant && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-[var(--text-primary)]">Books start date</h2>
          <form action={updateFiscalYearDates} className={settingsCard}>
            <fieldset disabled={!canEdit} className="space-y-4">
              <div>
                <label className={settingsLabel}>Fiscal year (B.S.)</label>
                <select name="fiscalYearLabel" required defaultValue={tenant.fiscalYearLabel ?? ""} className={settingsInput}>
                  <option value="" disabled>
                    Select fiscal year
                  </option>
                  {FISCAL_YEARS.map((fy) => (
                    <option key={fy} value={fy}>
                      {fy}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={settingsLabel}>Fiscal year beginning date</label>
                  <DateField name="fiscalYearStartDate" defaultValue={tenant.fiscalYearStartDate ?? ""} />
                </div>
                <div>
                  <label className={settingsLabel}>Fiscal year ending date</label>
                  <DateField name="fiscalYearEndDate" defaultValue={tenant.fiscalYearEndDate ?? ""} />
                </div>
              </div>
              <p className="text-xs text-gray-500">The beginning date is also the date opening balances (customers, suppliers, banks, assets) are posted on.</p>
              {canEdit && (
                <button type="submit" className={settingsButton}>
                  Save changes
                </button>
              )}
            </fieldset>
          </form>
        </section>
      )}
    </div>
  );
}
