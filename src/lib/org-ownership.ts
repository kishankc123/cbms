import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { listRoles } from "@/lib/role-store";
import { rateLimit } from "@/lib/rate-limit";

export type TransferInput = {
  tenantId: string;
  /** The Owner handing the organization over. */
  actingUserId: string;
  /** The member who becomes the Owner. */
  toUserId: string;
  /** The Owner's own password, asked again because this is not something to do by accident. */
  password: string;
  /** The role the previous Owner keeps (default: Administrator). Never Owner. */
  stepDownRoleId?: string | null;
};
export type TransferResult = { ok: true; newOwner: string; stepDownTo: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * Hands the organization over to another member: they become the Owner and the person handing over steps down to another role
 * (Administrator unless a different one is chosen), in one step, so the organization is never without an Owner. Only an Owner can
 * do it, only to an active member with a verified email, and only after typing their own password again. It is written to the audit log.
 * Permissions are read from the membership on every request, so both people's access changes at once.
 */
export async function transferOwnership(input: TransferInput): Promise<TransferResult> {
  if (input.toUserId === input.actingUserId) return fail("Choose someone other than yourself.");

  const [mine] = await db
    .select({ id: memberships.id, role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.actingUserId)))
    .limit(1);
  if (!mine || mine.status !== "active" || mine.role !== "owner") return fail("Only an Owner can hand the organization over.");

  const [target] = await db
    .select({ id: memberships.id, role: memberships.role, status: memberships.status, name: users.name, email: users.email, verified: users.emailVerifiedAt, userStatus: users.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.toUserId)))
    .limit(1);
  if (!target) return fail("That person is not a member of this organization.");
  if (target.status !== "active" || target.userStatus !== "active") return fail("Only an active member can become the Owner.");
  if (!target.verified) return fail("That person has not verified their email address yet, so they can't become the Owner.");
  if (target.role === "owner") return fail(`${target.name} is already an Owner.`);

  // Only password attempts are counted: that is the step someone could try to guess.
  if (!rateLimit(`transfer-ownership:${input.actingUserId}`, 5, 60 * 60 * 1000)) return fail("Too many attempts. Try again later.");
  const [me] = await db.select({ name: users.name, email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, input.actingUserId)).limit(1);
  if (!me || !input.password || !(await bcrypt.compare(input.password, me.passwordHash))) return fail("That password is not right.");

  const roleList = await listRoles(input.tenantId);
  const ownerRole = roleList.find((r) => r.systemKey === "owner");
  const stepDown = input.stepDownRoleId ? roleList.find((r) => r.id === input.stepDownRoleId) : roleList.find((r) => r.systemKey === "admin");
  if (!ownerRole) return fail("This organization has no Owner role set up.");
  if (!stepDown || !stepDown.isActive) return fail("Choose an active role for yourself to step down to.");
  if (stepDown.baseRole === "owner") return fail("Choose a role other than Owner for yourself, since you are handing ownership over.");

  await db.transaction(async (tx) => {
    await tx.update(memberships).set({ role: "owner", roleId: ownerRole.id }).where(eq(memberships.id, target.id));
    await tx.update(memberships).set({ role: stepDown.baseRole, roleId: stepDown.id }).where(eq(memberships.id, mine.id));
  });

  await logAuditEvent({
    tenantId: input.tenantId,
    userId: input.actingUserId,
    action: "ownership_transferred",
    entityType: "organization",
    entityId: input.tenantId,
    before: { owner: `${me.name} (${me.email})` },
    after: { owner: `${target.name} (${target.email})`, previousOwnerNowHas: stepDown.name },
  });
  return { ok: true, newOwner: target.name, stepDownTo: stepDown.name };
}
