"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

function parseOpeningBalance(formData: FormData): string {
  const amount = Math.abs(parseFloat(String(formData.get("openingBalance") ?? "0")) || 0);
  const type = String(formData.get("openingBalanceType") ?? "DR");
  const signed = type === "CR" ? -amount : amount;
  return signed.toFixed(2);
}

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
    openingBalance: parseOpeningBalance(formData),
  });

  revalidatePath("/customers");
  revalidatePath("/sales");
}

export async function updateCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");

  const id = String(formData.get("customerId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("Customer name is required");
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Customer not found");

  await db
    .update(customers)
    .set({
      name,
      contactInfo: {
        phone: phone || undefined,
        details: details || undefined,
      },
      openingBalance: parseOpeningBalance(formData),
    })
    .where(eq(customers.id, id));

  revalidatePath("/customers");
  revalidatePath("/sales");
}

export async function deleteCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "delete")) throw new Error("Not permitted");

  const id = String(formData.get("customerId") ?? "");

  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Customer not found");

  const [{ value: invoiceCount }] = await db
    .select({ value: count() })
    .from(salesInvoices)
    .where(eq(salesInvoices.customerId, id));
  if (invoiceCount > 0) {
    throw new Error(
      "Cannot delete a customer with existing sales invoices — void the invoices first if you need to remove this record"
    );
  }

  await db.delete(customers).where(eq(customers.id, id));

  revalidatePath("/customers");
  revalidatePath("/sales");
}
