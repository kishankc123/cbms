import { activeRegisteredTaxTypes } from "@/lib/compliance/registrations";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { todayIso } from "@/lib/calendar";

/**
 * The VAT rate to charge on a sale dated `date` (default today): the rate that was actually in force on that
 * date, but only while the organization holds an active VAT registration (Compliance > Tax Registrations). A
 * business that isn't VAT-registered must not charge VAT. A backdated invoice is taxed at the rate that applied
 * on its own date, not today's rate.
 */
export async function salesVatRate(tenantId: string, date: string = todayIso()): Promise<number> {
  const registered = (await activeRegisteredTaxTypes(tenantId)).includes("vat");
  if (!registered) return 0;
  return getTaxRate(tenantId, "vat", date);
}
