"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { changeTaxRate, getCurrentTaxRateInfo, getTaxRateHistory, type TaxTypeKey } from "@/lib/compliance/tax-rates";

export async function getTaxRateInfo(taxTypeKey: TaxTypeKey) {
  const session = await requireTenantSession();
  return getCurrentTaxRateInfo(session.tenantId, taxTypeKey);
}

export async function listTaxRateHistory(taxTypeKey: TaxTypeKey) {
  const session = await requireTenantSession();
  return getTaxRateHistory(session.tenantId, taxTypeKey);
}

export async function updateTaxRate(input: { taxTypeKey: TaxTypeKey; rate: number; effectiveFrom: string; reason?: string }) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");
  await changeTaxRate(session.tenantId, session.userId, input);
  revalidatePath("/compliance/company");
  revalidatePath("/settings");
}
