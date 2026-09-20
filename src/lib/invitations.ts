import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invitations, users, tenants } from "@/db/schema";
import { hashToken } from "@/lib/tokens";

export type LoadedInvitation = NonNullable<Awaited<ReturnType<typeof loadInvitation>>>;

// Server-only helpers (deliberately not server actions, so they can't be
// called from the browser).
export async function loadInvitation(token: string) {
  const [row] = await db
    .select({
      id: invitations.id,
      tenantId: invitations.tenantId,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      orgName: tenants.companyName,
      orgStatus: tenants.status,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.status !== "pending" || row.expiresAt < new Date() || row.orgStatus !== "active") return null;
  return row;
}

export async function invitationHasAccount(email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return Boolean(u);
}
