"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export async function createCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Customer name is required");
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();

  await db.insert(customers).values({
    tenantId: session.tenantId,
    name,
    contactInfo: {
      phone: phone || undefined,
      details: details || undefined,
    },
  });

  revalidatePath("/customers");
  revalidatePath("/sales");
}
