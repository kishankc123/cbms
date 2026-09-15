"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export async function createAccount(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "create")) {
    throw new Error("Not permitted");
  }

  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "") as
    | "asset"
    | "liability"
    | "equity"
    | "income"
    | "expense";

  if (!code || !name || !category) throw new Error("Code, name, and category are required");

  await db.insert(accounts).values({
    tenantId: session.tenantId,
    code,
    name,
    category,
  });

  revalidatePath("/chart-of-accounts");
}
