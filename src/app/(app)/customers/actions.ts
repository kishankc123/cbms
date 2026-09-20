"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, asc } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { reverseLatestEntryForSource } from "@/lib/ledger/post";
import { createCustomerReceivableAccount } from "@/lib/ledger/subledger-accounts";
import { syncCustomerOpeningBalanceEntry } from "@/lib/ledger/opening-balance";
import { getPartyLines } from "@/lib/ledger/party-ledger";
import { signedOpeningBalance } from "@/lib/ledger/opening-sign";
import { buildStatement } from "@/lib/ledger/party-statement";

function parseOpeningBalance(formData: FormData): string {
  const amount = Math.abs(parseFloat(String(formData.get("openingBalance") ?? "0")) || 0);
  const type = String(formData.get("openingBalanceType") ?? "DR");
  const signed = signedOpeningBalance("customer", amount, type === "CR" ? "CR" : "DR");
  return signed.toFixed(2);
}

export async function createCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Customer name is required");
  const panNumber = String(formData.get("panNumber") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const openingBalance = parseOpeningBalance(formData);

  const [customer] = await db
    .insert(customers)
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

  // Every customer gets their own Accounts Receivable sub-account
  // immediately — the account every sale/receipt for them posts to.
  const receivableAccount = await createCustomerReceivableAccount(session.tenantId, name);
  await db.update(customers).set({ receivableAccountId: receivableAccount.id }).where(eq(customers.id, customer.id));

  await syncCustomerOpeningBalanceEntry(session.tenantId, customer.id, name, Number(openingBalance), session.userId);

  revalidatePath("/customers");
  revalidatePath("/sales");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

export async function updateCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");

  const id = String(formData.get("customerId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) throw new Error("Customer name is required");
  const panNumber = String(formData.get("panNumber") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const openingBalance = parseOpeningBalance(formData);

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
      panNumber: panNumber || null,
      contactInfo: {
        phone: phone || undefined,
        details: details || undefined,
      },
      openingBalance,
    })
    .where(eq(customers.id, id));

  await syncCustomerOpeningBalanceEntry(session.tenantId, id, name, Number(openingBalance), session.userId);

  revalidatePath("/customers");
  revalidatePath("/sales");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

export async function deleteCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "delete")) throw new Error("Not permitted");

  const id = String(formData.get("customerId") ?? "");

  const [existing] = await db
    .select({ id: customers.id, name: customers.name })
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

  await reverseLatestEntryForSource(session.tenantId, "opening_balance", id, session.userId, `Customer deleted - ${existing.name}`);
  await db.delete(customers).where(eq(customers.id, id));

  revalidatePath("/customers");
  revalidatePath("/sales");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}

export type LedgerRow = { date: string; details: string; debit: number; credit: number; balance: number };

export async function getCustomerHistory(customerId: string, from?: string, to?: string) {
  const session = await requireTenantSession();

  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!customer) throw new Error("Customer not found");

  // Read from the customer's own ledger account: invoices, receipts, the opening balance and any
  // manual journal voucher posted to it, so it always agrees with the Chart of Accounts.
  const lines = customer.receivableAccountId ? (await getPartyLines(session.tenantId, [customer.receivableAccountId])).get(customer.receivableAccountId) ?? [] : [];
  const statement = buildStatement(lines, "debit", { from, to });
  return { name: customer.name, openingBalance: statement.openingBalance, closingBalance: statement.closingBalance, rows: statement.rows };
}
