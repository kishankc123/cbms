"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills, payments } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

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
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();

  await db.insert(vendors).values({
    tenantId: session.tenantId,
    name,
    contactInfo: {
      phone: phone || undefined,
      details: details || undefined,
    },
    openingBalance: parseOpeningBalance(formData),
  });

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
}

export async function updateSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const id = String(formData.get("supplierId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("Supplier name is required");
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();

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
      contactInfo: {
        phone: phone || undefined,
        details: details || undefined,
      },
      openingBalance: parseOpeningBalance(formData),
    })
    .where(eq(vendors.id, id));

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
}

export async function deleteSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "delete")) throw new Error("Not permitted");

  const id = String(formData.get("supplierId") ?? "");

  const [existing] = await db
    .select({ id: vendors.id })
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

  await db.delete(vendors).where(eq(vendors.id, id));

  revalidatePath("/suppliers");
  revalidatePath("/purchases");
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
    db
      .select({ date: payments.paymentDate, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.paidToVendorId, supplierId), eq(payments.tenantId, session.tenantId)))
      .orderBy(asc(payments.paymentDate)),
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

  const rows: Omit<LedgerRow, "balance">[] = [];
  for (const b of activeBills) {
    if (!inRange(b.date)) continue;
    rows.push({ date: b.date, details: `Purchase bill ${b.billNumber}`, debit: Number(b.total), credit: 0 });
  }
  for (const p of supplierPayments) {
    if (!inRange(p.date)) continue;
    rows.push({ date: p.date, details: "Payment made", debit: 0, credit: Number(p.amount) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  let running = openingBalance;
  const ledgerRows: LedgerRow[] = rows.map((r) => {
    running += r.debit - r.credit;
    return { ...r, balance: running };
  });

  return { name: supplier.name, openingBalance, closingBalance: running, rows: ledgerRows };
}
