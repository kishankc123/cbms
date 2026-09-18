"use server";

import { revalidatePath } from "next/cache";
import { and, eq, like, count } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalLines } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { categoryForSubCategory } from "@/lib/ledger/account-sub-categories";

export async function createAccount(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "create")) {
    throw new Error("Not permitted");
  }

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const subCategory = String(formData.get("subCategory") ?? "").trim();
  const category = categoryForSubCategory(subCategory);

  if (!code || !name || !category) throw new Error("Code, name, and category are required");

  await db.insert(accounts).values({
    tenantId: session.tenantId,
    code,
    name,
    category,
    subCategory,
  });

  revalidatePath("/chart-of-accounts");
}

export async function createSubGroupAccount(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "create")) {
    throw new Error("Not permitted");
  }

  const parentAccountId = String(formData.get("parentAccountId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!parentAccountId || !name) throw new Error("Group and name are required");

  const [parent] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, parentAccountId), eq(accounts.tenantId, session.tenantId)))
    .limit(1);
  if (!parent) throw new Error("Group not found");

  // Sub-group codes extend the parent group's code, e.g. two sub-groups under
  // "1010" become "1010.01" and "1010.02".
  const siblings = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), like(accounts.code, `${parent.code}.%`)));
  const nextSeq = siblings.length + 1;
  const code = `${parent.code}.${String(nextSeq).padStart(2, "0")}`;

  await db.insert(accounts).values({
    tenantId: session.tenantId,
    code,
    name,
    category: parent.category,
    subCategory: parent.subCategory,
    parentAccountId: parent.id,
  });

  revalidatePath("/chart-of-accounts/sub-groups");
}

export async function updateAccount(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "edit")) {
    throw new Error("Not permitted");
  }

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const isActive = formData.get("isActive") === "on";
  const subCategoryRaw = formData.get("subCategory");
  if (!id || !name) throw new Error("Name is required");

  const update: { name: string; isActive: boolean; category?: "asset" | "liability" | "equity" | "income" | "expense"; subCategory?: string } = {
    name,
    isActive,
  };
  if (subCategoryRaw !== null) {
    const subCategory = String(subCategoryRaw).trim();
    const category = categoryForSubCategory(subCategory);
    if (!category) throw new Error("Invalid category");
    update.category = category;
    update.subCategory = subCategory;
  }

  await db
    .update(accounts)
    .set(update)
    .where(and(eq(accounts.id, id), eq(accounts.tenantId, session.tenantId)));

  revalidatePath("/chart-of-accounts");
  revalidatePath("/chart-of-accounts/sub-groups");
}

export async function deleteAccount(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "delete")) {
    throw new Error("Not permitted");
  }

  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Account id is required");

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.tenantId, session.tenantId)))
    .limit(1);
  if (!account) throw new Error("Account not found");

  const [{ value: transactionCount }] = await db
    .select({ value: count() })
    .from(journalLines)
    .where(eq(journalLines.accountId, id));
  if (transactionCount > 0) {
    throw new Error("This account has transaction history and cannot be deleted");
  }

  const [{ value: childCount }] = await db
    .select({ value: count() })
    .from(accounts)
    .where(eq(accounts.parentAccountId, id));
  if (childCount > 0) {
    throw new Error("This group has sub-groups and cannot be deleted");
  }

  await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.tenantId, session.tenantId)));

  revalidatePath("/chart-of-accounts");
  revalidatePath("/chart-of-accounts/sub-groups");
}
