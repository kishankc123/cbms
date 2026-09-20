import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { activeRegisteredTaxTypes } from "@/lib/compliance/registrations";

/**
 * The VAT rate to charge on sales: the organization's rate, but only while it holds an active VAT
 * registration (Compliance > Tax Registrations). A business that isn't VAT-registered must not charge VAT.
 */
export async function salesVatRate(tenantId: string): Promise<number> {
  const registered = (await activeRegisteredTaxTypes(tenantId)).includes("vat");
  if (!registered) return 0;
  const [tenant] = await db.select({ vatRate: tenants.vatRate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return parseFloat(tenant?.vatRate ?? "0") || 0;
}
