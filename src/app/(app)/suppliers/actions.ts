"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { requirePan } from "@/lib/pan";
import { reverseLatestEntryForSource } from "@/lib/ledger/post";
import { createSupplierPayableAccount } from "@/lib/ledger/subledger-accounts";
import { syncSupplierOpeningBalanceEntry } from "@/lib/ledger/opening-balance";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { signedOpeningBalance } from "@/lib/ledger/opening-sign";
import { buildStatement } from "@/lib/ledger/party-statement";

function parseOpeningBalance(formData: FormData): string {
  const amount = Math.abs(parseFloat(String(formData.get("openingBalance") ?? "0")) || 0);
  const type = String(formData.get("openingBalanceType") ?? "DR");
  const signed = signedOpeningBalance("supplier", amount, type === "CR" ? "CR" : "DR");
  return signed.toFixed(2);
}

export async function createSupplier(formData: FormData): Promise<{ id: string; name: string }> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Supplier name is required");
  const panNumber = requirePan(formData.get("panNumber"), "PAN / VAT number");
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const openingBalance = parseOpeningBalance(formData);

  const [supplier] = await db
    .insert(vendors)
    .values({
      tenantId: session.tenantId,
      name,
      panNumber: panNumber || null,
      contactInfo: {
        phone: phone || undefined,
        details: details || undefined,
      },
      openingBalance,
    })
    .returning();

  // Every supplier gets their own Accounts Payable sub-account
  // immediately — the account every purchase/payment for them posts to.
  const payableAccount = await createSupplierPayableAccount(session.tenantId, name);
  await db.update(vendors).set({ payableAccountId: payableAccount.id }).where(eq(vendors.id, supplier.id));

  await syncSupplierOpeningBalanceEntry(session.tenantId, supplier.id, name, Number(openingBalance), session.userId);

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
  return { id: supplier.id, name };
}

export async function updateSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const id = String(formData.get("supplierId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("Supplier name is required");
  const panNumber = requirePan(formData.get("panNumber"), "PAN / VAT number");
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const openingBalance = parseOpeningBalance(formData);

  const [existing] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, id), eq(vendors.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Supplier not found");

  await db
    .update(vendors)
    .set({
      name,
      panNumber: panNumber || null,
      contactInfo: {
        phone: phone || undefined,
        details: details || undefined,
      },
      openingBalance,
    })
    .where(eq(vendors.id, id));

  await syncSupplierOpeningBalanceEntry(session.tenantId, id, name, Number(openingBalance), session.userId);

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

export async function deleteSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "delete")) throw new Error("Not permitted");

  const id = String(formData.get("supplierId") ?? "");

  const [existing] = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.id, id), eq(vendors.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Supplier not found");

  const [{ value: billCount }] = await db
    .select({ value: count() })
    .from(purchaseBills)
    .where(eq(purchaseBills.vendorId, id));
  if (billCount > 0) {
    throw new Error(
      "Cannot delete a supplier with existing purchase bills — void the bills first if you need to remove this record"
    );
  }

  await reverseLatestEntryForSource(session.tenantId, "opening_balance", id, session.userId, `Supplier deleted - ${existing.name}`);
  await db.delete(vendors).where(eq(vendors.id, id));

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

export type LedgerRow = { date: string; details: string; debit: number; credit: number; balance: number };

export async function getSupplierHistory(supplierId: string, from?: string, to?: string) {
  const session = await requireTenantSession();

  const [supplier] = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.id, supplierId), eq(vendors.tenantId, session.tenantId)))
    .limit(1);
  if (!supplier) throw new Error("Supplier not found");

  // Read from the supplier's own ledger account: bills, payments, the opening balance and any
  // manual journal voucher posted to it, so it always agrees with the Chart of Accounts.
  const lines = supplier.payableAccountId ? (await getPartyLines(session.tenantId, [supplier.payableAccountId])).get(supplier.payableAccountId) ?? [] : [];
  const statement = buildStatement(lines, "credit", { from, to });
  return { name: supplier.name, openingBalance: statement.openingBalance, closingBalance: statement.closingBalance, rows: statement.rows };
}
