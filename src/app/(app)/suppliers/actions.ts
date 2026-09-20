"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { reverseLatestEntryForSource } from "@/lib/ledger/post";
import { createSupplierPayableAccount } from "@/lib/ledger/subledger-accounts";
import { syncSupplierOpeningBalanceEntry } from "@/lib/ledger/opening-balance";
import { getSupplierPaymentRows } from "@/lib/ledger/supplier-balances";

function parseOpeningBalance(formData: FormData): string {
  const amount = Math.abs(parseFloat(String(formData.get("openingBalance") ?? "0")) || 0);
  const type = String(formData.get("openingBalanceType") ?? "DR");
  const signed = type === "CR" ? -amount : amount;
  return signed.toFixed(2);
}

export async function createSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Supplier name is required");
  const panNumber = String(formData.get("panNumber") ?? "").trim();
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
}

export async function updateSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const id = String(formData.get("supplierId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("Supplier name is required");
  const panNumber = String(formData.get("panNumber") ?? "").trim();
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

  const [bills, supplierPayments] = await Promise.all([
    db
      .select({
        date: purchaseBills.billDate,
        billNumber: purchaseBills.billNumber,
        total: purchaseBills.total,
        status: purchaseBills.status,
      })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.vendorId, supplierId), eq(purchaseBills.tenantId, session.tenantId)))
      .orderBy(asc(purchaseBills.billDate)),
    getSupplierPaymentRows(session.tenantId, supplierId),
  ]);

  const activeBills = bills.filter((b) => b.status !== "void");

  const isBeforeFrom = (date: string) => !!from && date < from;
  const inRange = (date: string) => {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  };

  const openingBalance =
    Number(supplier.openingBalance) +
    activeBills.filter((b) => isBeforeFrom(b.date)).reduce((s, b) => s + Number(b.total), 0) -
    supplierPayments.filter((p) => isBeforeFrom(p.date)).reduce((s, p) => s + Number(p.amount), 0);

  // Accounts Payable is a liability — a purchase bill increases what we owe,
  // which is a credit to this account, while a payment reduces it (a debit).
  const rows: Omit<LedgerRow, "balance">[] = [];
  for (const b of activeBills) {
    if (!inRange(b.date)) continue;
    rows.push({ date: b.date, details: `Purchase bill ${b.billNumber}`, debit: 0, credit: Number(b.total) });
  }
  for (const p of supplierPayments) {
    if (!inRange(p.date)) continue;
    rows.push({ date: p.date, details: "Payment made", debit: Number(p.amount), credit: 0 });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  let running = openingBalance;
  const ledgerRows: LedgerRow[] = rows.map((r) => {
    running += r.credit - r.debit;
    return { ...r, balance: running };
  });

  return { name: supplier.name, openingBalance, closingBalance: running, rows: ledgerRows };
}
