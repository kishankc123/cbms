"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { loadPermit, recordRenewal, setStandardRenewalFee, undoLatestRenewal, type RenewalInput } from "@/lib/compliance/excise-permit";
import { permitMessage } from "@/lib/compliance/excise-permit-rules";

// The excise permit panel in Tax Compliance. Seeing it needs compliance view; changing the fee or recording a renewal needs edit.

const refresh = () => {
  revalidatePath("/compliance");
  revalidatePath("/compliance/tax");
  revalidatePath("/compliance/calendar");
};

export async function getExcisePermit() {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  const permit = await loadPermit(session.tenantId);
  return { canEdit: can(session, "compliance", "edit"), permit: permit ? { ...permit, message: permitMessage(permit.status) } : null };
}
export type ExcisePermitView = Awaited<ReturnType<typeof getExcisePermit>>;

export async function saveExciseFee(fee: number | null) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to change the permit." };
  const r = await setStandardRenewalFee(session.tenantId, session.userId, fee);
  if (r.ok) refresh();
  return r;
}

export async function recordExciseRenewal(input: RenewalInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to record a renewal." };
  const r = await recordRenewal(session.tenantId, session.userId, input);
  if (r.ok) refresh();
  return r;
}

export async function undoExciseRenewal() {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to change the permit." };
  const r = await undoLatestRenewal(session.tenantId, session.userId);
  if (r.ok) refresh();
  return r;
}
