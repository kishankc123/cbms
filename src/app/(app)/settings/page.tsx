import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { generateFiscalYearOptions } from "@/lib/nepali-fiscal-year";
import { INVOICE_NUMBER_FORMATS, buildInvoiceNumber } from "@/lib/invoice-number";
import { updateCompanyDetails, updateFiscalYearDates, updateOtherSettings, updatePaymentNumbering } from "./actions";

const FISCAL_YEARS = generateFiscalYearOptions();

export default async function SettingsPage() {
  const session = await requireTenantSession();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  if (!tenant) {
    return <p className="text-sm text-gray-500">Tenant not found.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <Link href="/settings/users" className="text-sm text-[var(--color-primary)] hover:underline">
          Manage users →
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Details</h2>

        <form
          action={updateCompanyDetails}
          className="max-w-lg space-y-4 rounded-lg border border-gray-200 bg-white p-5"
        >
          <div>
            <label className="block text-xs text-gray-500 mb-1">Company name</label>
            <input
              name="companyName"
              required
              defaultValue={tenant.companyName}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Industry</label>
            <input
              name="industry"
              defaultValue={tenant.industry ?? ""}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base currency</label>
              <input
                name="baseCurrency"
                defaultValue={tenant.baseCurrency}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tax registration number</label>
              <input
                name="taxRegistrationNumber"
                defaultValue={tenant.taxRegistrationNumber ?? ""}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
          >
            Save changes
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Dates</h2>

        <form
          action={updateFiscalYearDates}
          className="max-w-lg space-y-4 rounded-lg border border-gray-200 bg-white p-5"
        >
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fiscal year (B.S.)</label>
            <select
              name="fiscalYearLabel"
              required
              defaultValue={tenant.fiscalYearLabel ?? ""}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
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
              <label className="block text-xs text-gray-500 mb-1">Fiscal year beginning date</label>
              <input
                type="date"
                name="fiscalYearStartDate"
                defaultValue={tenant.fiscalYearStartDate ?? ""}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fiscal year ending date</label>
              <input
                type="date"
                name="fiscalYearEndDate"
                defaultValue={tenant.fiscalYearEndDate ?? ""}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
          >
            Save changes
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Other</h2>

        <form
          action={updateOtherSettings}
          className="max-w-lg space-y-4 rounded-lg border border-gray-200 bg-white p-5"
        >
          <div className="grid grid-cols-2 gap-4 max-w-lg">
            <div>
              <label className="block text-xs text-gray-500 mb-1">VAT rate (%)</label>
              <input
                type="number"
                name="vatRate"
                step="0.01"
                min="0"
                max="100"
                required
                defaultValue={tenant.vatRate}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">TDS rate (%)</label>
              <input
                type="number"
                name="tdsRate"
                step="0.01"
                min="0"
                max="100"
                required
                defaultValue={tenant.tdsRate}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice prefix</label>
              <input
                name="invoicePrefix"
                defaultValue={tenant.invoicePrefix ?? ""}
                placeholder="INV"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice suffix</label>
              <input
                name="invoiceSuffix"
                defaultValue={tenant.invoiceSuffix ?? ""}
                placeholder="26"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Invoice number arrangement</label>
            <select
              name="invoiceNumberFormat"
              defaultValue={tenant.invoiceNumberFormat}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {INVOICE_NUMBER_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Example: {buildInvoiceNumber(tenant.invoicePrefix ?? "INV", tenant.invoiceSuffix ?? "", 4, tenant.invoiceNumberFormat)}
            </p>
          </div>

          <button
            type="submit"
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
          >
            Save changes
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Payments</h2>

        <form
          action={updatePaymentNumbering}
          className="max-w-lg space-y-4 rounded-lg border border-gray-200 bg-white p-5"
        >
          <div>
            <label className="block text-xs text-gray-500 mb-1">Numbering</label>
            <select
              name="paymentNumberMode"
              defaultValue={tenant.paymentNumberMode}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="single">Single sequence (PAY-000001) for both directions</option>
              <option value="split">Separate sequences — Receipt (REC-) / Payment (PAY-)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment prefix</label>
              <input
                name="paymentPrefix"
                defaultValue={tenant.paymentPrefix ?? ""}
                placeholder="PAY-"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment suffix</label>
              <input
                name="paymentSuffix"
                defaultValue={tenant.paymentSuffix ?? ""}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Receipt prefix (split mode)</label>
              <input
                name="receiptPrefix"
                defaultValue={tenant.receiptPrefix ?? ""}
                placeholder="REC-"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Receipt suffix (split mode)</label>
              <input
                name="receiptSuffix"
                defaultValue={tenant.receiptSuffix ?? ""}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Number arrangement</label>
            <select
              name="paymentNumberFormat"
              defaultValue={tenant.paymentNumberFormat}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {INVOICE_NUMBER_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Example: {buildInvoiceNumber(tenant.paymentPrefix ?? "PAY-", tenant.paymentSuffix ?? "", 1, tenant.paymentNumberFormat)}
            </p>
          </div>

          <button
            type="submit"
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5"
          >
            Save changes
          </button>
        </form>
      </section>
    </div>
  );
}
