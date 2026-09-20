import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { findControlAccount, createSubAccount } from "./control-accounts";

// Money received from a customer before an invoice exists, or the
// unallocated remainder of a customer payment that overshoots their
// outstanding invoices — a liability until applied to a real invoice.
export async function getOrCreateCustomerAdvanceAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["2350"], "Customer Advance");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "2350", name: "Customer Advance", category: "liability", subCategory: "Current liabilities" })
    .returning();
  return created;
}

async function getOrCreateSubAccountId(
  tenantId: string,
  parent: { id: string; code: string; category: (typeof accounts.$inferSelect)["category"]; subCategory: string | null },
  name: string
) {
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, parent.id), eq(accounts.name, name)))
    .limit(1);
  if (existing) return existing.id;
  const created = await createSubAccount(tenantId, parent, name);
  return created.id;
}

export async function getOrCreateCustomerAdvanceSubAccountId(tenantId: string, customerName: string) {
  const parent = await getOrCreateCustomerAdvanceAccount(tenantId);
  return getOrCreateSubAccountId(tenantId, parent, customerName);
}

// Money paid to a supplier before their purchase/bill exists — an asset
// (prepayment) until applied to a real bill.
export async function getOrCreateSupplierAdvanceAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["1350"], "Supplier Advance");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "1350", name: "Supplier Advance", category: "asset", subCategory: "Current assets" })
    .returning();
  return created;
}

export async function getOrCreateSupplierAdvanceSubAccountId(tenantId: string, supplierName: string) {
  const parent = await getOrCreateSupplierAdvanceAccount(tenantId);
  return getOrCreateSubAccountId(tenantId, parent, supplierName);
}

export async function getOrCreateOwnerDrawingsAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["3050"], "Owner's Drawings");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "3050", name: "Owner's Drawings", category: "equity" })
    .returning();
  return created;
}
