"use server";

import { redirect } from "next/navigation";
import { unstable_update } from "@/lib/auth";
import { requireUserSession } from "@/lib/session";
import { hasActiveMembership, listActiveMemberships } from "@/lib/memberships";
import { createOrganization, type BusinessInfo } from "@/lib/organizations";
import { rateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit";

// Switches the session's active organization. The membership is verified here
// AND again inside the auth token callback, so the id can't be forged from the
// browser.
export async function switchOrganization(tenantId: string): Promise<void> {
  const user = await requireUserSession();
  if (!(await hasActiveMembership(user.id, tenantId))) {
    throw new Error("You don't have access to that organization.");
  }
  await unstable_update({ activeTenantId: tenantId } as never);
  await logAuditEvent({ tenantId, userId: user.id, action: "organization_switched", entityType: "organization", entityId: tenantId });
  redirect("/dashboard");
}

export async function listMyOrganizations() {
  const user = await requireUserSession();
  return listActiveMemberships(user.id);
}

export async function createAdditionalOrganization(info: BusinessInfo): Promise<{ ok: false; error: string } | void> {
  const user = await requireUserSession();
  if (!rateLimit(`create-org:${user.id}`, 5, 60 * 60 * 1000)) return { ok: false, error: "Too many attempts. Please try again later." };
  if (!info.name.trim()) return { ok: false, error: "Business name is required." };

  const tenant = await createOrganization(info, user.id);
  await unstable_update({ activeTenantId: tenant.id } as never);
  redirect("/dashboard");
}
