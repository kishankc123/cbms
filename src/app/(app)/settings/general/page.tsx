import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import { INVOICE_NUMBER_FORMATS, buildInvoiceNumber } from "@/lib/invoice-number";
import { updateCalendarSystem, updateOtherSettings, updatePaymentNumbering } from "../actions";
import { ReadOnlyNotice, SettingsHeader, SettingsSection, settingsButton, settingsCard, settingsInput, settingsLabel } from "../ui";

export default async function GeneralSettingsPage() {
  const session = await requireTenantSession();
  if (!can(session, "settings", "view")) return <p className="text-sm text-gray-500">You don&apos;t have permission to view settings.</p>;
  const canEdit = can(session, "settings", "edit");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) return <p className="text-sm text-gray-500">Tenant not found.</p>;

  const save = canEdit && (
    <button type="submit" className={settingsButton}>
      Save changes
    </button>
  );

  return (
    <div className="space-y-8">
      <SettingsHeader title="General" description="How dates are shown, and how invoices and payments are numbered." />
      <ReadOnlyNotice canEdit={canEdit} />

      <SettingsSection title="Localization">
        <form action={updateCalendarSystem} className={settingsCard}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <div>
              <p className="mb-2 block text-xs text-gray-500">Calendar system</p>
              <label className="mb-1 flex items-center gap-2 text-sm text-gray-800">
                <input type="radio" name="calendarSystem" value="AD" defaultChecked={tenant.calendarSystem !== "BS"} />
                AD — Gregorian
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input type="radio" name="calendarSystem" value="BS" defaultChecked={tenant.calendarSystem === "BS"} />
                BS — Bikram Sambat
              </label>
            </div>
            <p className="text-xs text-gray-500">Choose how dates are displayed and entered throughout the system. Accounting records are internally maintained using a standard date format, so changing this never alters any transaction.</p>
            {save}
          </fieldset>
        </form>
      </SettingsSection>

      <SettingsSection title="Invoice numbering">
        <form action={updateOtherSettings} className={settingsCard}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={settingsLabel}>Invoice prefix</label>
                <input name="invoicePrefix" defaultValue={tenant.invoicePrefix ?? ""} placeholder="INV" className={settingsInput} />
              </div>
              <div>
                <label className={settingsLabel}>Invoice suffix</label>
                <input name="invoiceSuffix" defaultValue={tenant.invoiceSuffix ?? ""} placeholder="26" className={settingsInput} />
              </div>
            </div>
            <div>
              <label className={settingsLabel}>Invoice number arrangement</label>
              <select name="invoiceNumberFormat" defaultValue={tenant.invoiceNumberFormat} className={settingsInput}>
                {INVOICE_NUMBER_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Example: {buildInvoiceNumber(tenant.invoicePrefix ?? "INV", tenant.invoiceSuffix ?? "", 4, tenant.invoiceNumberFormat)}</p>
            </div>
            {save}
          </fieldset>
        </form>
      </SettingsSection>

      <SettingsSection title="Payment numbering">
        <form action={updatePaymentNumbering} className={settingsCard}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <div>
              <label className={settingsLabel}>Numbering</label>
              <select name="paymentNumberMode" defaultValue={tenant.paymentNumberMode} className={settingsInput}>
                <option value="single">Single sequence (PAY-000001) for both directions</option>
                <option value="split">Separate sequences — Receipt (REC-) / Payment (PAY-)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={settingsLabel}>Payment prefix</label>
                <input name="paymentPrefix" defaultValue={tenant.paymentPrefix ?? ""} placeholder="PAY-" className={settingsInput} />
              </div>
              <div>
                <label className={settingsLabel}>Payment suffix</label>
                <input name="paymentSuffix" defaultValue={tenant.paymentSuffix ?? ""} className={settingsInput} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={settingsLabel}>Receipt prefix (split mode)</label>
                <input name="receiptPrefix" defaultValue={tenant.receiptPrefix ?? ""} placeholder="REC-" className={settingsInput} />
              </div>
              <div>
                <label className={settingsLabel}>Receipt suffix (split mode)</label>
                <input name="receiptSuffix" defaultValue={tenant.receiptSuffix ?? ""} className={settingsInput} />
              </div>
            </div>
            <div>
              <label className={settingsLabel}>Number arrangement</label>
              <select name="paymentNumberFormat" defaultValue={tenant.paymentNumberFormat} className={settingsInput}>
                {INVOICE_NUMBER_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Example: {buildInvoiceNumber(tenant.paymentPrefix ?? "PAY-", tenant.paymentSuffix ?? "", 1, tenant.paymentNumberFormat)}</p>
            </div>
            {save}
          </fieldset>
        </form>
      </SettingsSection>
    </div>
  );
}
