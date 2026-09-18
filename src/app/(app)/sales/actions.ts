"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count } from "drizzle-orm";
import { db } from "@/db";
import { salesInvoices, journalEntries, tenants, bankAccounts, receipts, accounts, customers } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { buildInvoiceNumber } from "@/lib/invoice-number";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type BatchPaymentLine = {
  accountId: string;
  amount: number;
};

export type BatchInvoiceRow = {
  invoiceDate: string;
  customerId: string;
  grossAmount: number;
  discountAmount: number;
  payments: BatchPaymentLine[];
};

// Used when a row is settled in full with no customer chosen — a customer is
// only required when the payment doesn't cover the invoice total, since the
// shortfall has to be tracked as that customer's outstanding balance.
async function ensureCashCustomer(tenantId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.name, "Cash Sale")))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(customers).values({ tenantId, name: "Cash Sale", openingBalance: "0" }).returning();
  return created.id;
}

async function ensureBankAccount(tenantId: string, chartAccountId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.chartOfAccountsLink, chartAccountId)))
    .limit(1);
  if (existing) return existing.id;

  const [account] = await db.select().from(accounts).where(eq(accounts.id, chartAccountId)).limit(1);
  const [created] = await db
    .insert(bankAccounts)
    .values({ tenantId, accountName: account?.name ?? "Cash/Bank", chartOfAccountsLink: chartAccountId })
    .returning();
  return created.id;
}

// This is the only place invoices get written — the grid's RECORD PAY button
// only captures payment intent locally; nothing is persisted until this runs
// (triggered solely by the page's Save button).
export async function recordSalesBatch(input: { rows: BatchInvoiceRow[] }) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const validRows = input.rows.filter((r) => r.invoiceDate && r.grossAmount > 0);
  if (validRows.length === 0) throw new Error("Add at least one invoice row");

  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i];
    if (r.discountAmount < 0 || r.discountAmount > r.grossAmount) {
      throw new Error(`Row ${i + 1}: discount must be between 0 and the gross amount`);
    }
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  const ar = await findControlAccount(session.tenantId, ["1100"], "Accounts Receivable");
  if (!ar) throw new Error("No Accounts Receivable account found — add one to the Chart of Accounts first");

  const revenueAccount = await findControlAccount(session.tenantId, ["4000"], "Sales Revenue");
  if (!revenueAccount) throw new Error("No Sales Revenue account found — add one to the Chart of Accounts first");

  const computedRows = validRows.map((r) => {
    const subtotal = round2(r.grossAmount - r.discountAmount);
    const taxAmount = round2(subtotal * (vatRate / 100));
    const total = round2(subtotal + taxAmount);
    const paid = round2(r.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
    return { ...r, subtotal, taxAmount, total, paid };
  });

  // A customer only has to be picked when a row's own recorded payment
  // doesn't fully cover its total — the shortfall needs somewhere to land.
  for (let i = 0; i < computedRows.length; i++) {
    const row = computedRows[i];
    if (row.paid < row.total && !row.customerId) {
      throw new Error(`Row ${i + 1}: select a customer — the recorded payment doesn't cover the invoice total`);
    }
  }

  const hasTax = computedRows.some((r) => r.taxAmount > 0);
  let taxPayableId: string | null = null;
  if (hasTax) {
    const taxPayable = await findControlAccount(session.tenantId, ["2100"], "Tax Payable");
    if (!taxPayable) throw new Error("No Tax Payable account found — add one to the Chart of Accounts first");
    taxPayableId = taxPayable.id;
  }

  const cashCustomerId = computedRows.some((r) => !r.customerId) ? await ensureCashCustomer(session.tenantId) : null;

  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(salesInvoices)
    .where(eq(salesInvoices.tenantId, session.tenantId));
  let nextSequence = existingCount + 1;

  for (const row of computedRows) {
    const { subtotal, taxAmount, total, paid } = row;
    const customerId = row.customerId || cashCustomerId!;
    const invoiceNumber = buildInvoiceNumber(
      tenant?.invoicePrefix,
      tenant?.invoiceSuffix,
      nextSequence,
      tenant?.invoiceNumberFormat ?? "prefix-number-suffix"
    );
    nextSequence++;

    const status = paid >= total ? "paid" : paid > 0 ? "partially_paid" : "sent";

    const [invoice] = await db
      .insert(salesInvoices)
      .values({
        tenantId: session.tenantId,
        customerId,
        invoiceNumber,
        invoiceDate: row.invoiceDate,
        grossAmount: row.grossAmount.toFixed(2),
        discountAmount: row.discountAmount.toFixed(2),
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        total: total.toFixed(2),
        amountPaid: paid.toFixed(2),
        status,
      })
      .returning();

    const lines: PostLineInput[] = [
      { accountId: ar.id, debitAmount: total, description: `Invoice ${invoiceNumber}` },
      { accountId: revenueAccount.id, creditAmount: subtotal, description: `Invoice ${invoiceNumber}` },
    ];
    if (taxAmount > 0 && taxPayableId) {
      lines.push({ accountId: taxPayableId, creditAmount: taxAmount, description: `Tax on invoice ${invoiceNumber}` });
    }

    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: row.invoiceDate,
      sourceType: "sale",
      sourceId: invoice.id,
      referenceNumber: invoiceNumber,
      memo: `Sales invoice ${invoiceNumber}`,
      createdBy: session.userId,
      lines,
    });

    if (paid > 0) {
      const paymentLines = row.payments.filter((p) => p.accountId && p.amount > 0);
      const journalLines: PostLineInput[] = paymentLines.map((p) => ({
        accountId: p.accountId,
        debitAmount: p.amount,
        description: `Payment received for ${invoiceNumber}`,
      }));
      journalLines.push({ accountId: ar.id, creditAmount: paid, description: `Payment received for ${invoiceNumber}` });

      await postJournalEntry({
        tenantId: session.tenantId,
        entryDate: row.invoiceDate,
        sourceType: "receipt",
        memo: `Payment received for ${invoiceNumber}`,
        createdBy: session.userId,
        lines: journalLines,
      });

      const primaryBankAccountId = await ensureBankAccount(session.tenantId, paymentLines[0].accountId);
      await db.insert(receipts).values({
        tenantId: session.tenantId,
        receiptDate: row.invoiceDate,
        receivedFromCustomerId: customerId,
        amount: paid.toFixed(2),
        bankAccountId: primaryBankAccountId,
        appliedToInvoiceIds: [invoice.id],
      });
    }
  }

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
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
