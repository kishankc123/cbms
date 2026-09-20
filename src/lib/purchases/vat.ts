import { activeRegisteredTaxTypes } from "@/lib/compliance/registrations";

/**
 * Input VAT can be claimed back (booked to Tax Receivable) only by an organization with an active VAT
 * registration. Otherwise the VAT a supplier charges is simply part of what the goods or service cost.
 */
export async function inputVatClaimable(tenantId: string): Promise<boolean> {
  return (await activeRegisteredTaxTypes(tenantId)).includes("vat");
}
