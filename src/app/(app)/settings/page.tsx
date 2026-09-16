import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { requireTenantSession } from "@/lib/session";
import { updateTenantSettings } from "./actions";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default async function SettingsPage() {
  const session = await requireTenantSession();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);

  if (!tenant) {
    return <p className="text-sm text-gray-500">Tenant not found.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Company profile</h2>

        <form
          action={updateTenantSettings}
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
              <label className="block text-xs text-gray-500 mb-1">Fiscal year start month</label>
              <select
                name="fiscalYearStartMonth"
                defaultValue={tenant.fiscalYearStartMonth}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base currency</label>
              <input
                name="baseCurrency"
                defaultValue={tenant.baseCurrency}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Tax registration number</label>
            <input
              name="taxRegistrationNumber"
              defaultValue={tenant.taxRegistrationNumber ?? ""}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
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
