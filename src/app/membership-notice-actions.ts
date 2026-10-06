"use server";

import { requireUserSession } from "@/lib/session";
import { dismissAddNotice, leaveOrganization } from "@/lib/org-members";

// The person's side of being added to an organization: dismiss the notice, or leave.

export async function dismissNotice(membershipId: string) {
  const user = await requireUserSession();
  await dismissAddNotice(user.id, membershipId);
}

export async function leaveOrganizationAction(membershipId: string) {
  const user = await requireUserSession();
  return leaveOrganization(user.id, membershipId);
}
