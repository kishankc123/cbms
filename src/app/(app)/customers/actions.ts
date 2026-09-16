"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, asc } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, receipts } from "@/db/schema";
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

export type LedgerRow = { date: string; details: string; debit: number; credit: number; balance: number };

export async function getCustomerHistory(customerId: string) {
  const session = await requireTenantSession();

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!customer) throw new Error("Customer not found");

  const [invoices, customerReceipts] = await Promise.all([
    db
      .select({
        date: salesInvoices.invoiceDate,
        invoiceNumber: salesInvoices.invoiceNumber,
        total: salesInvoices.total,
        status: salesInvoices.status,
      })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.customerId, customerId), eq(salesInvoices.tenantId, session.tenantId)))
      .orderBy(asc(salesInvoices.invoiceDate)),
    db
      .select({ date: receipts.receiptDate, amount: receipts.amount })
      .from(receipts)
      .where(and(eq(receipts.receivedFromCustomerId, customerId), eq(receipts.tenantId, session.tenantId)))
      .orderBy(asc(receipts.receiptDate)),
  ]);

  const rows: Omit<LedgerRow, "balance">[] = [];
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    rows.push({ date: inv.date, details: `Sales invoice ${inv.invoiceNumber}`, debit: Number(inv.total), credit: 0 });
  }
  for (const r of customerReceipts) {
    rows.push({ date: r.date, details: "Payment received", debit: 0, credit: Number(r.amount) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const openingBalance = Number(customer.openingBalance);
  let running = openingBalance;
  const ledgerRows: LedgerRow[] = rows.map((r) => {
    running += r.debit - r.credit;
    return { ...r, balance: running };
  });

  return { name: customer.name, openingBalance, rows: ledgerRows };
}
