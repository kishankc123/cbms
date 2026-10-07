"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, type AppSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { createPaymentMode, deletePaymentMode, listLinkableAccounts, listPaymentModes, updatePaymentMode, type ModeInput } from "@/lib/payment-modes";

async function requireOrgAdmin(): Promise<AppSession> {
  const session = await requireTenantSession();
  if (!isOrgAdmin(session.role)) throw new Error("Only an Owner or Administrator can manage payment modes.");
  return session;
}

export async function getPaymentModes() {
  const session = await requireOrgAdmin();
  const [modes, linkable] = await Promise.all([listPaymentModes(session.tenantId), listLinkableAccounts(session.tenantId)]);
  return { modes, linkable };
}
export type PaymentModesData = Awaited<ReturnType<typeof getPaymentModes>>;

export async function savePaymentMode(modeId: string | null, input: ModeInput) {
  const session = await requireOrgAdmin();
  const result = modeId ? await updatePaymentMode(session.tenantId, session.userId, modeId, input) : await createPaymentMode(session.tenantId, session.userId, input);
  if (result.ok) revalidatePath("/settings", "layout");
  return result;
}

export async function removePaymentMode(modeId: string) {
  const session = await requireOrgAdmin();
  const result = await deletePaymentMode(session.tenantId, session.userId, modeId);
  if (result.ok) revalidatePath("/settings", "layout");
  return result;
}
