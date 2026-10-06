import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { updateCompanyDetails } from "../actions";
import { ReadOnlyNotice, SettingsHeader, settingsButton, settingsCard, settingsInput, settingsLabel } from "../ui";

export default async function CompanySettingsPage() {
  const session = await requireTenantSession();
  if (!can(session, "settings", "view")) return <p className="text-sm text-gray-500">You don&apos;t have permission to view settings.</p>;
  const canEdit = can(session, "settings", "edit");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) return <p className="text-sm text-gray-500">Tenant not found.</p>;

  return (
    <div className="space-y-6">
      <SettingsHeader title="Company details" description="Your organization's name, currency and registration numbers.">
        <Link href="/compliance/company" className="text-sm text-[var(--color-primary)] hover:underline">
          VAT / TDS rates →
        </Link>
      </SettingsHeader>
      <ReadOnlyNotice canEdit={canEdit} />

      <form action={updateCompanyDetails} className={settingsCard}>
        <fieldset disabled={!canEdit} className="space-y-4">
          <div>
            <label className={settingsLabel}>Company name</label>
            <input name="companyName" required defaultValue={tenant.companyName} className={settingsInput} />
          </div>
          <div>
            <label className={settingsLabel}>Industry</label>
            <input name="industry" defaultValue={tenant.industry ?? ""} className={settingsInput} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={settingsLabel}>Base currency</label>
              <input name="baseCurrency" defaultValue={tenant.baseCurrency} className={settingsInput} />
            </div>
            <div>
              <label className={settingsLabel}>Company registration number</label>
              <input name="companyRegistrationNumber" defaultValue={tenant.companyRegistrationNumber ?? ""} className={settingsInput} />
            </div>
          </div>
          <div>
            <label className={settingsLabel}>PAN / VAT number *</label>
            <input name="panVatNumber" required inputMode="numeric" maxLength={9} pattern="[0-9]{9}" title="Exactly 9 digits" defaultValue={tenant.panVatNumber ?? ""} className={settingsInput} />
          </div>
          {canEdit && (
            <button type="submit" className={settingsButton}>
              Save changes
            </button>
          )}
        </fieldset>
      </form>
    </div>
  );
}
