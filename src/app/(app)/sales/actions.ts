"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { customers, salesInvoices, journalEntries } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";

export async function createCustomer(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Customer name is required");
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  await db.insert(customers).values({
    tenantId: session.tenantId,
    name,
    contactInfo: { email: email || undefined, phone: phone || undefined },
  });

  revalidatePath("/sales");
}

type LineItemInput = { description: string; quantity: number; unitPrice: number; taxRate: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createInvoice(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const customerId = String(formData.get("customerId") ?? "");
  const invoiceDate = String(formData.get("invoiceDate"));
  const dueDate = String(formData.get("dueDate") ?? "") || undefined;
  const revenueAccountId = String(formData.get("revenueAccountId") ?? "");
  if (!customerId || !invoiceDate || !revenueAccountId) {
    throw new Error("Customer, invoice date, and revenue account are required");
  }

  const descriptions = formData.getAll("itemDescription") as string[];
  const quantities = formData.getAll("itemQuantity") as string[];
  const unitPrices = formData.getAll("itemUnitPrice") as string[];
  const taxRates = formData.getAll("itemTaxRate") as string[];

  const lineItems: LineItemInput[] = descriptions
    .map((description, i) => ({
      description,
      quantity: parseFloat(quantities[i] || "0") || 0,
      unitPrice: parseFloat(unitPrices[i] || "0") || 0,
      taxRate: parseFloat(taxRates[i] || "0") || 0,
    }))
    .filter((l) => l.description && l.quantity > 0 && l.unitPrice > 0);

  if (lineItems.length === 0) throw new Error("At least one line item is required");

  const subtotal = round2(lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const taxAmount = round2(
    lineItems.reduce((s, l) => s + l.quantity * l.unitPrice * (l.taxRate / 100), 0)
  );
  const total = round2(subtotal + taxAmount);

  const ar = await findControlAccount(session.tenantId, ["1100"], "Accounts Receivable");
  if (!ar) {
    throw new Error("No Accounts Receivable account found — add one to the Chart of Accounts first");
  }

  let taxPayableId: string | null = null;
  if (taxAmount > 0) {
    const taxPayable = await findControlAccount(session.tenantId, ["2100"], "Tax Payable");
    if (!taxPayable) {
      throw new Error("No Tax Payable account found — add one to the Chart of Accounts first");
    }
    taxPayableId = taxPayable.id;
  }

  const [{ value: invoiceCount }] = await db
    .select({ value: count() })
    .from(salesInvoices)
    .where(eq(salesInvoices.tenantId, session.tenantId));
  const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

  const [invoice] = await db
    .insert(salesInvoices)
    .values({
      tenantId: session.tenantId,
      customerId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      lineItems,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      status: "sent",
    })
    .returning();

  const lines = [
    { accountId: ar.id, debitAmount: total, description: `Invoice ${invoiceNumber}` },
    { accountId: revenueAccountId, creditAmount: subtotal, description: `Invoice ${invoiceNumber}` },
  ];
  if (taxAmount > 0 && taxPayableId) {
    lines.push({ accountId: taxPayableId, creditAmount: taxAmount, description: `Tax on invoice ${invoiceNumber}` });
  }

  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: invoiceDate,
    sourceType: "sale",
    sourceId: invoice.id,
    referenceNumber: invoiceNumber,
    memo: `Sales invoice ${invoiceNumber}`,
    createdBy: session.userId,
    lines,
  });

  revalidatePath("/sales");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export async function voidInvoice(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "delete")) throw new Error("Not permitted");

  const invoiceId = String(formData.get("invoiceId"));

  const [invoice] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.tenantId, session.tenantId)))
    .limit(1);
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "void") throw new Error("Invoice is already void");

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, session.tenantId),
        eq(journalEntries.sourceType, "sale"),
        eq(journalEntries.sourceId, invoiceId)
      )
    )
    .limit(1);

  if (entry && !entry.isReversed) {
    await reverseJournalEntry(session.tenantId, entry.id, session.userId, `Void of invoice ${invoice.invoiceNumber}`);
  }

  await db.update(salesInvoices).set({ status: "void" }).where(eq(salesInvoices.id, invoiceId));

  revalidatePath("/sales");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}
