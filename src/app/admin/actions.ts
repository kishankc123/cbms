"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { forceSignOut, getPlatformOrg, getPlatformUser, listPlatformOrgs, listPlatformUsers, platformCounts, setOrgStatus, setPlatformAdmin, setUserStatus, unlockUser } from "@/lib/platform-admin";

// Every action here is for the platform administrator only, and each one checks that itself.

const refresh = () => revalidatePath("/admin", "layout");

export async function getAdminOverview() {
  await requirePlatformAdmin();
  return platformCounts();
}

export async function getAdminUsers(params: { search?: string; status?: string; admins?: boolean; page?: number; pageSize?: number }) {
  await requirePlatformAdmin();
  return listPlatformUsers({ search: params.search, status: params.status, admins: params.admins, page: params.page ?? 1, pageSize: [25, 50, 100].includes(params.pageSize ?? 0) ? params.pageSize! : 25 });
}

export async function getAdminUser(userId: string) {
  const me = await requirePlatformAdmin();
  const data = await getPlatformUser(userId);
  return data ? { ...data, isMe: data.user.id === me.id } : null;
}
export type AdminUser = NonNullable<Awaited<ReturnType<typeof getAdminUser>>>;

export async function changeUserStatus(userId: string, status: "active" | "disabled") {
  const me = await requirePlatformAdmin();
  const result = await setUserStatus(me.id, userId, status);
  if (result.ok) refresh();
  return result;
}

export async function unlockAccount(userId: string) {
  const me = await requirePlatformAdmin();
  const result = await unlockUser(me.id, userId);
  if (result.ok) refresh();
  return result;
}

export async function signUserOut(userId: string) {
  const me = await requirePlatformAdmin();
  const result = await forceSignOut(me.id, userId);
  if (result.ok) refresh();
  return result;
}

export async function changePlatformAdmin(userId: string, makeAdmin: boolean) {
  const me = await requirePlatformAdmin();
  const result = await setPlatformAdmin(me.id, userId, makeAdmin);
  if (result.ok) refresh();
  return result;
}

export async function getAdminOrgs(params: { search?: string; status?: string; page?: number; pageSize?: number }) {
  await requirePlatformAdmin();
  return listPlatformOrgs({ search: params.search, status: params.status, page: params.page ?? 1, pageSize: [25, 50, 100].includes(params.pageSize ?? 0) ? params.pageSize! : 25 });
}

export async function getAdminOrg(tenantId: string) {
  await requirePlatformAdmin();
  return getPlatformOrg(tenantId);
}
export type AdminOrg = NonNullable<Awaited<ReturnType<typeof getAdminOrg>>>;

export async function changeOrgStatus(tenantId: string, status: "active" | "suspended", reason: string) {
  const me = await requirePlatformAdmin();
  const result = await setOrgStatus(me.id, tenantId, status, reason);
  if (result.ok) refresh();
  return result;
}
