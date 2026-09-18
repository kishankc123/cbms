"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, asc } from "drizzle-orm";
import { db } from "@/db";
import { vendors, purchaseBills, payments, tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseLatestEntryForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount, getOrCreateBroughtForwardAccount } from "@/lib/ledger/control-accounts";

function parseOpeningBalance(formData: FormData): string {
  const amount = Math.abs(parseFloat(String(formData.get("openingBalance") ?? "0")) || 0);
  const type = String(formData.get("openingBalanceType") ?? "DR");
  const signed = type === "CR" ? -amount : amount;
  return signed.toFixed(2);
}

async function openingBalanceEntryDate(tenantId: string) {
  const [tenant] = await db.select({ fiscalYearStartDate: tenants.fiscalYearStartDate }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant?.fiscalYearStartDate || new Date().toISOString().slice(0, 10);
}

// Posts a supplier's opening balance against "Brought forward" — the AP
// mirror of the customer version. A positive balance means we owe the
// supplier (the normal AP credit balance); negative means we're prepaid.
async function syncSupplierOpeningBalanceEntry(
  tenantId: string,
  supplierId: string,
  supplierName: string,
  openingBalance: number,
  userId: string
) {
  await reverseLatestEntryForSource(tenantId, "opening_balance", supplierId, userId, `Opening balance update - ${supplierName}`);
  if (openingBalance === 0) return;

  const ap = await findControlAccount(tenantId, ["2000"], "Accounts Payable");
  if (!ap) throw new Error("No Accounts Payable account found — add one to the Chart of Accounts first");
  const broughtForward = await getOrCreateBroughtForwardAccount(tenantId);

  const amount = Math.abs(openingBalance);
  const lines: PostLineInput[] =
    openingBalance > 0
      ? [
          { accountId: broughtForward.id, debitAmount: amount, description: `Opening balance - ${supplierName}` },
          { accountId: ap.id, creditAmount: amount, description: `Opening balance - ${supplierName}` },
        ]
      : [
          { accountId: ap.id, debitAmount: amount, description: `Opening balance - ${supplierName}` },
          { accountId: broughtForward.id, creditAmount: amount, description: `Opening balance - ${supplierName}` },
        ];

  await postJournalEntry({
    tenantId,
    entryDate: await openingBalanceEntryDate(tenantId),
    sourceType: "opening_balance",
    sourceId: supplierId,
    referenceNumber: supplierName,
    memo: `Opening balance - ${supplierName}`,
    createdBy: userId,
    lines,
  });
}

export async function createSupplier(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Supplier name is required");
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const openingBalance = parseOpeningBalance(formData);

  const [supplier] = await db
    .insert(vendors)
    .values({
      tenantId: session.tenantId,
      name,
      contactInfo: {
        phone: phone || undefined,
        details: details || undefined,
      },
      openingBalance,
    })
    .returning();

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
