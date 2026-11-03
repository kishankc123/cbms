import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceTaxHeads, tenants, vendors } from "@/db/schema";
import { headRateKey, payeeRateKey, payeeTypeLabel } from "./platform-tax-rate-types";
import { getTaxRate, publishedRateOn } from "./tax-rates";

/**
 * The TDS rate of a heading on a date. Where the heading's rate depends on who is paid, the supplier's business type picks it
 * (company, proprietorship / individual); a supplier with no type, or a type with no rate published, takes the heading's own rate.
 * `basis` says in a few words what the rate rests on, for the form to show next to it (null when the heading has one rate).
 */
export async function tdsRateOn(tenantId: string, headKey: string, date: string, vendorId?: string | null): Promise<{ rate: number; basis: string | null }> {
  const base = headRateKey("tds", headKey);
  const [head] = await db
    .select({ byPayeeType: complianceTaxHeads.byPayeeType })
    .from(complianceTaxHeads)
    .innerJoin(tenants, eq(tenants.countryCode, complianceTaxHeads.countryCode))
    .where(and(eq(tenants.id, tenantId), eq(complianceTaxHeads.taxTypeKey, "tds"), eq(complianceTaxHeads.key, headKey)))
    .limit(1);
  if (!head?.byPayeeType) return { rate: await getTaxRate(tenantId, base, date), basis: null };

  const [vendor] = vendorId ? await db.select({ businessType: vendors.businessType }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1) : [];
  const type = vendor?.businessType ?? null;
  const label = payeeTypeLabel(type)?.toLowerCase();
  const own = type && label ? await publishedRateOn(tenantId, payeeRateKey("tds", headKey, type), date) : null;
  if (own !== null && label) return { rate: own, basis: label };
  return { rate: await getTaxRate(tenantId, base, date), basis: label ? `no ${label} rate published, general rate used` : "supplier type not set" };
}
