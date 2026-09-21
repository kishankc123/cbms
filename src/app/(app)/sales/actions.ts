"use server";

import { revalidatePath } from "next/cache";
import { and, eq, or, desc, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  salesInvoices,
  journalEntries,
  journalLines,
  tenants,
  bankAccounts,
  payments,
  paymentAllocations,
  accounts,
  customers,
  type LineItem,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateCustomerReceivableAccountId } from "@/lib/ledger/subledger-accounts";
import { buildInvoiceNumber } from "@/lib/invoice-number";
import { withPaymentNumber } from "@/lib/payment-number";
import { applyStockDelta, computeCogsTotal } from "@/lib/inventory/stock";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { salesVatRate } from "@/lib/sales/vat";
import { assertCashBankAccounts, assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { todayIso } from "@/lib/calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Every invoice number in use in this organization (void ones too — a number is never reused).
async function takenInvoiceNumbers(tenantId: string, excludeInvoiceId?: string) {
  const rows = await db.select({ id: salesInvoices.id, n: salesInvoices.invoiceNumber }).from(salesInvoices).where(eq(salesInvoices.tenantId, tenantId));
  return new Set(rows.filter((r) => r.id !== excludeInvoiceId).map((r) => r.n));
}

async function assertInvoiceNumberFree(tenantId: string, invoiceNumber: string, excludeInvoiceId?: string) {
  if ((await takenInvoiceNumbers(tenantId, excludeInvoiceId)).has(invoiceNumber)) throw new Error(`Invoice number ${invoiceNumber} is already used`);
}

// A failed save must not leave half an invoice behind: undo whatever posted and drop the row.
async function discardInvoice(tenantId: string, invoiceId: string, userId: string) {
  await reverseAllActiveEntriesForSource(tenantId, invoiceId, userId, "Rolled back — invoice could not be saved").catch(() => {});
  await deleteEmbeddedPaymentsForInvoice(tenantId, invoiceId).catch(() => {});
  await db.delete(salesInvoices).where(eq(salesInvoices.id, invoiceId));
}

// A reversal entry is itself never marked isReversed, so at any time there
// can be more than one isReversed=false row sharing a sourceId (the latest
// correct repost, plus older reversal entries sitting inert). Reversing all
// of them would reverse-a-reversal and resurrect stale amounts — only the
// single most recent one is ever the "currently in force" entry.
async function reverseLatestActiveEntry(tenantId: string, where: SQL | undefined, userId: string, memo: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(where)
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);

  if (entry) {
    await reverseJournalEntry(tenantId, entry.id, userId, memo);
  }
}

// Reverses an invoice's active "sale" entry (AR/Revenue) and, if any, its
// active "receipt" entry (payment) — so editing or voiding an invoice fully
// undoes what it posted. Receipt entries posted before sourceId was tracked
// on them have no sourceId to match, so they're also matched by their old
// fixed memo text as a fallback.
async function reverseActiveEntriesForInvoice(
  tenantId: string,
  invoiceId: string,
  invoiceNumber: string,
  userId: string,
  memo: string
) {
  await reverseLatestActiveEntry(
    tenantId,
    and(
      eq(journalEntries.tenantId, tenantId),
      eq(journalEntries.sourceType, "sale"),
      eq(journalEntries.sourceId, invoiceId),
      eq(journalEntries.isReversed, false)
    ),
    userId,
    memo
  );

  await reverseLatestActiveEntry(
    tenantId,
    and(
      eq(journalEntries.tenantId, tenantId),
      eq(journalEntries.sourceType, "receipt"),
      eq(journalEntries.isReversed, false),
      or(eq(journalEntries.sourceId, invoiceId), eq(journalEntries.memo, `Payment received for ${invoiceNumber}`))
    ),
    userId,
    memo
  );

  // Cost-of-goods-sold for stockable items posts as its own "expense"-sourced
  // entry against the same invoice — reversed alongside the sale/receipt
  // entries on edit or void.
  await reverseLatestActiveEntry(
    tenantId,
    and(
      eq(journalEntries.tenantId, tenantId),
      eq(journalEntries.sourceType, "expense"),
      eq(journalEntries.sourceId, invoiceId),
      eq(journalEntries.isReversed, false)
    ),
    userId,
    memo
  );
}

// Books the cost side of a sale for stockable items — Dr Cost of Goods Sold,
// Cr Inventory — as its own "expense"-sourced entry tied to the invoice.
// Skipped entirely (no entry posted) when nothing sold has a cost basis.
async function postCogsEntry(
  tenantId: string,
  entryDate: string,
  invoiceId: string,
  invoiceNumber: string,
  userId: string,
  lines: { itemId?: string | null; quantity: number }[]
) {
  const cost = await computeCogsTotal(tenantId, lines);
  if (cost <= 0) return;

  const cogs = await findControlAccount(tenantId, ["5000"], "Cost of Goods Sold");
  if (!cogs) throw new Error("No Cost of Goods Sold account found — add one to the Chart of Accounts first");
  const inventory = await findControlAccount(tenantId, ["1200"], "Inventory");
  if (!inventory) throw new Error("No Inventory account found — add one to the Chart of Accounts first");

  await postJournalEntry({
    tenantId,
    entryDate,
    sourceType: "expense",
    sourceId: invoiceId,
    referenceNumber: invoiceNumber,
    memo: `COGS for invoice ${invoiceNumber}`,
    createdBy: userId,
    lines: [
      { accountId: cogs.id, debitAmount: cost, description: `COGS for invoice ${invoiceNumber}` },
      { accountId: inventory.id, creditAmount: cost, description: `COGS for invoice ${invoiceNumber}` },
    ],
  });
}

// Deletes the embedded (paid-at-creation) Payment-module row(s) recorded
// for this invoice, cascading to their allocation rows — used before a void
// or edit re-posts fresh entries, mirroring how the old receipts table was
// cleared in the same spots.
async function deleteEmbeddedPaymentsForInvoice(tenantId: string, invoiceId: string) {
  const rows = await db
    .select({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "embedded"), eq(paymentAllocations.targetType, "sales_invoice"), eq(paymentAllocations.targetId, invoiceId)));

  const paymentIds = [...new Set(rows.map((r) => r.paymentId))];
  if (paymentIds.length > 0) {
    await db.delete(payments).where(and(eq(payments.tenantId, tenantId), or(...paymentIds.map((id) => eq(payments.id, id)))));
  }
}

// Records the embedded customer-payment row (+ its allocation to this
// invoice) in the unified Payment module for a payment captured at invoice
// creation/edit time — the accounting entry itself is posted separately by
// the caller, unchanged; this is purely the Payment module's own record of
// that same fact so it shows up in the Payments list and reconciliation.
async function insertEmbeddedCustomerPayment(
  tenantId: string,
  userId: string,
  customerId: string,
  invoiceId: string,
  paymentDate: string,
  amount: number,
  accountId: string,
  journalEntryId: string,
  referenceNumber: string
) {
  const [row] = await withPaymentNumber(tenantId, "money_in", (paymentNumber) =>
    db
    .insert(payments)
    .values({
      tenantId,
      paymentNumber,
      direction: "money_in",
      paymentType: "customer_payment",
      paymentDate,
      partyType: "customer",
      customerId,
      accountId,
      paymentMethod: "cash",
      referenceNumber,
      amount: amount.toFixed(2),
      description: `Payment received for ${referenceNumber}`,
      status: "posted",
      origin: "embedded",
      journalEntryId,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    })
    .returning()
  );

  await db.insert(paymentAllocations).values({ paymentId: row.id, targetType: "sales_invoice", targetId: invoiceId, allocatedAmount: amount.toFixed(2) });
}

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
  const vatRate = await salesVatRate(session.tenantId);

  // Refuse up front if any invoice date sits in a locked period, before anything is saved.
  for (const date of new Set(validRows.map((r) => r.invoiceDate))) await assertPeriodOpen(session.tenantId, date);
  await assertCashBankAccounts(session.tenantId, validRows.flatMap((r) => r.payments.filter((p) => p.amount > 0).map((p) => p.accountId)));

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

  const taken = await takenInvoiceNumbers(session.tenantId);
  let nextSequence = taken.size + 1;

  const arCache = new Map<string, string>();
  async function resolveAr(customerId: string) {
    const cached = arCache.get(customerId);
    if (cached) return cached;
    const id = await getOrCreateCustomerReceivableAccountId(session.tenantId, customerId);
    arCache.set(customerId, id);
    return id;
  }

  for (const row of computedRows) {
    const { subtotal, taxAmount, total, paid } = row;
    const customerId = row.customerId || cashCustomerId!;
    const arId = await resolveAr(customerId);
    const next = nextFreeInvoiceNumber(
      taken,
      (n) => buildInvoiceNumber(tenant?.invoicePrefix, tenant?.invoiceSuffix, n, tenant?.invoiceNumberFormat ?? "prefix-number-suffix"),
      nextSequence
    );
    const invoiceNumber = next.number;
    taken.add(invoiceNumber);
    nextSequence = next.sequence + 1;

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

    try {
      const lines: PostLineInput[] = [
        { accountId: arId, debitAmount: total, description: `Invoice ${invoiceNumber}` },
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
        const receiptLines: PostLineInput[] = paymentLines.map((p) => ({
          accountId: p.accountId,
          debitAmount: p.amount,
          description: `Payment received for ${invoiceNumber}`,
        }));
        receiptLines.push({ accountId: arId, creditAmount: paid, description: `Payment received for ${invoiceNumber}` });

        const receiptEntry = await postJournalEntry({
          tenantId: session.tenantId,
          entryDate: row.invoiceDate,
          sourceType: "receipt",
          sourceId: invoice.id,
          referenceNumber: invoiceNumber,
          memo: `Payment received for ${invoiceNumber}`,
          createdBy: session.userId,
          lines: receiptLines,
        });

        await ensureBankAccount(session.tenantId, paymentLines[0].accountId);
        await insertEmbeddedCustomerPayment(
          session.tenantId,
          session.userId,
          customerId,
          invoice.id,
          row.invoiceDate,
          paid,
          paymentLines[0].accountId,
          receiptEntry.id,
          invoiceNumber
        );
      }
    } catch (e) {
      await discardInvoice(session.tenantId, invoice.id, session.userId);
      throw e;
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
  await assertNoLaterPayments(session.tenantId, "sales_invoice", invoiceId, "invoice");

  await reverseActiveEntriesForInvoice(
    session.tenantId,
    invoiceId,
    invoice.invoiceNumber,
    session.userId,
    `Void of invoice ${invoice.invoiceNumber}`
  );
  await deleteEmbeddedPaymentsForInvoice(session.tenantId, invoiceId);
  await applyStockDelta(session.tenantId, (invoice.lineItems ?? []) as LineItem[], 1);

  await db.update(salesInvoices).set({ status: "void" }).where(eq(salesInvoices.id, invoiceId));

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
  revalidatePath("/inventory/items");
}

export type SingleInvoiceEditLine = {
  itemId: string | null;
  description: string;
  rate: number;
  quantity: number;
  discount: number;
};

export type SingleInvoiceEditData = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customerId: string;
  lines: SingleInvoiceEditLine[];
  payments: BatchPaymentLine[];
};

// Payments aren't stored on the invoice row itself, so the split is
// reconstructed from the invoice's active "receipt" journal entry. An
// invoice created via Multi-invoice has no line items (it only ever stored
// gross/discount totals) — that's synthesized here as a single "Custom" line
// so editing always lands in the Single invoice format, letting the user add
// real item detail to it from that point on.
export async function getSalesInvoiceForEdit(invoiceId: string): Promise<SingleInvoiceEditData> {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");

  const [invoice] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.tenantId, session.tenantId)))
    .limit(1);
  if (!invoice) throw new Error("Invoice not found");

  const [receiptEntry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, session.tenantId),
        eq(journalEntries.sourceType, "receipt"),
        eq(journalEntries.sourceId, invoiceId),
        eq(journalEntries.isReversed, false)
      )
    )
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);

  let payments: BatchPaymentLine[] = [];
  if (receiptEntry) {
    const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, receiptEntry.id));
    payments = lines
      .filter((l) => Number(l.debitAmount) > 0)
      .map((l) => ({ accountId: l.accountId, amount: Number(l.debitAmount) }));
  }

  const storedLines = (invoice.lineItems ?? []) as LineItem[];
  const lines: SingleInvoiceEditLine[] =
    storedLines.length > 0
      ? storedLines.map((l) => ({
          itemId: l.itemId ?? null,
          description: l.description,
          rate: l.unitPrice,
          quantity: l.quantity,
          discount: l.discount ?? 0,
        }))
      : [
          {
            itemId: null,
            description: "",
            rate: Number(invoice.grossAmount),
            quantity: 1,
            discount: Number(invoice.discountAmount),
          },
        ];

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    customerId: invoice.customerId,
    lines,
    payments,
  };
}

export type UpdateSingleInvoiceInput = SingleInvoiceInput & { invoiceId: string };

// Editing reverses the invoice's old entries (sale + receipt) and posts
// fresh ones from the updated fields, same correction pattern used
// everywhere else in the ledger.
export async function updateSingleInvoice(input: UpdateSingleInvoiceInput) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, input.invoiceId), eq(salesInvoices.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Invoice not found");
  if (existing.status === "void") throw new Error("Cannot edit a void invoice");

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (!input.customerId) throw new Error("Select a customer");
  if (!input.invoiceDate) throw new Error("Invoice date is required");
  await assertInvoiceNumberFree(session.tenantId, invoiceNumber, input.invoiceId);
  // Editing reverses the old entries (dated today) and re-posts on the invoice date — both periods must be open,
  // checked before anything is reversed so a locked period cannot leave the invoice half-edited.
  await assertPeriodOpen(session.tenantId, input.invoiceDate);
  await assertPeriodOpen(session.tenantId, todayIso());
  await assertNoLaterPayments(session.tenantId, "sales_invoice", input.invoiceId, "invoice");
  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));

  const vatRate = await salesVatRate(session.tenantId);

  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const computed = validLines.map((l) => computeSingleLine(l, vatRate));
  const grossAmount = round2(computed.reduce((s, c) => s + c.gross, 0));
  const discountAmount = round2(computed.reduce((s, c) => s + c.discount, 0));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "sent";

  const arId = await getOrCreateCustomerReceivableAccountId(session.tenantId, input.customerId);
  const revenueAccount = await findControlAccount(session.tenantId, ["4000"], "Sales Revenue");
  if (!revenueAccount) throw new Error("No Sales Revenue account found — add one to the Chart of Accounts first");

  let taxPayableId: string | null = null;
  if (taxAmount > 0) {
    const taxPayable = await findControlAccount(session.tenantId, ["2100"], "Tax Payable");
    if (!taxPayable) throw new Error("No Tax Payable account found — add one to the Chart of Accounts first");
    taxPayableId = taxPayable.id;
  }

  await reverseActiveEntriesForInvoice(
    session.tenantId,
    input.invoiceId,
    existing.invoiceNumber,
    session.userId,
    `Edit of invoice ${existing.invoiceNumber}`
  );
  await deleteEmbeddedPaymentsForInvoice(session.tenantId, input.invoiceId);
  await applyStockDelta(session.tenantId, (existing.lineItems ?? []) as LineItem[], 1);
  await applyStockDelta(session.tenantId, validLines, -1);

  await db
    .update(salesInvoices)
    .set({
      customerId: input.customerId,
      invoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate || null,
      lineItems: validLines.map((l) => ({
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.rate,
        discount: l.discount,
        taxRate: vatRate,
      })),
      grossAmount: grossAmount.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      amountPaid: paid.toFixed(2),
      status,
    })
    .where(eq(salesInvoices.id, input.invoiceId));

  const lines: PostLineInput[] = [
    { accountId: arId, debitAmount: total, description: `Invoice ${invoiceNumber}` },
    { accountId: revenueAccount.id, creditAmount: subtotal, description: `Invoice ${invoiceNumber}` },
  ];
  if (taxAmount > 0 && taxPayableId) {
    lines.push({ accountId: taxPayableId, creditAmount: taxAmount, description: `Tax on invoice ${invoiceNumber}` });
  }

  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.invoiceDate,
    sourceType: "sale",
    sourceId: input.invoiceId,
    referenceNumber: invoiceNumber,
    memo: `Sales invoice ${invoiceNumber} (edited)`,
    createdBy: session.userId,
    lines,
  });

  await postCogsEntry(session.tenantId, input.invoiceDate, input.invoiceId, invoiceNumber, session.userId, validLines);

  if (paid > 0) {
    const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
    const receiptLines: PostLineInput[] = paymentLines.map((p) => ({
      accountId: p.accountId,
      debitAmount: p.amount,
      description: `Payment received for ${invoiceNumber}`,
    }));
    receiptLines.push({ accountId: arId, creditAmount: paid, description: `Payment received for ${invoiceNumber}` });

    const receiptEntry = await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.invoiceDate,
      sourceType: "receipt",
      sourceId: input.invoiceId,
      referenceNumber: invoiceNumber,
      memo: `Payment received for ${invoiceNumber} (edited)`,
      createdBy: session.userId,
      lines: receiptLines,
    });

    await ensureBankAccount(session.tenantId, paymentLines[0].accountId);
    await insertEmbeddedCustomerPayment(
      session.tenantId,
      session.userId,
      input.customerId,
      input.invoiceId,
      input.invoiceDate,
      paid,
      paymentLines[0].accountId,
      receiptEntry.id,
      invoiceNumber
    );
  }

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
  revalidatePath("/inventory/items");
}

export type SingleInvoiceLine = {
  itemId: string | null;
  description: string;
  rate: number;
  quantity: number;
  discount: number;
};

export type SingleInvoicePayment = { accountId: string; amount: number };

export type SingleInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  customerId: string;
  lines: SingleInvoiceLine[];
  payments: SingleInvoicePayment[];
};

function computeSingleLine(line: SingleInvoiceLine, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  const total = round2(taxable + vat);
  return { gross, discount, taxable, vat, total };
}

// A Single invoice is one customer bill with multiple item lines — the same
// shape as a Stockable purchase invoice, just on the sales side. Unlike
// Multi-invoice's batch grid, the customer is always required upfront (no
// "Cash Sale" fallback) and this creates exactly one invoice per Save.
export async function createSingleInvoice(input: SingleInvoiceInput) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (!input.customerId) throw new Error("Select a customer");
  if (!input.invoiceDate) throw new Error("Invoice date is required");
  await assertInvoiceNumberFree(session.tenantId, invoiceNumber);
  await assertPeriodOpen(session.tenantId, input.invoiceDate);
  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));

  const vatRate = await salesVatRate(session.tenantId);

  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const computed = validLines.map((l) => computeSingleLine(l, vatRate));
  const grossAmount = round2(computed.reduce((s, c) => s + c.gross, 0));
  const discountAmount = round2(computed.reduce((s, c) => s + c.discount, 0));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "sent";

  const arId = await getOrCreateCustomerReceivableAccountId(session.tenantId, input.customerId);
  const revenueAccount = await findControlAccount(session.tenantId, ["4000"], "Sales Revenue");
  if (!revenueAccount) throw new Error("No Sales Revenue account found — add one to the Chart of Accounts first");

  let taxPayableId: string | null = null;
  if (taxAmount > 0) {
    const taxPayable = await findControlAccount(session.tenantId, ["2100"], "Tax Payable");
    if (!taxPayable) throw new Error("No Tax Payable account found — add one to the Chart of Accounts first");
    taxPayableId = taxPayable.id;
  }

  const [invoice] = await db
    .insert(salesInvoices)
    .values({
      tenantId: session.tenantId,
      customerId: input.customerId,
      invoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate || null,
      lineItems: validLines.map((l) => ({
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.rate,
        discount: l.discount,
        taxRate: vatRate,
      })),
      grossAmount: grossAmount.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      amountPaid: paid.toFixed(2),
      status,
    })
    .returning();

  let stockApplied = false;
  try {
    const lines: PostLineInput[] = [
      { accountId: arId, debitAmount: total, description: `Invoice ${invoiceNumber}` },
      { accountId: revenueAccount.id, creditAmount: subtotal, description: `Invoice ${invoiceNumber}` },
    ];
    if (taxAmount > 0 && taxPayableId) {
      lines.push({ accountId: taxPayableId, creditAmount: taxAmount, description: `Tax on invoice ${invoiceNumber}` });
    }

    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.invoiceDate,
      sourceType: "sale",
      sourceId: invoice.id,
      referenceNumber: invoiceNumber,
      memo: `Sales invoice ${invoiceNumber}`,
      createdBy: session.userId,
      lines,
    });

    await postCogsEntry(session.tenantId, input.invoiceDate, invoice.id, invoiceNumber, session.userId, validLines);
    await applyStockDelta(session.tenantId, validLines, -1);
    stockApplied = true;

    if (paid > 0) {
      const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
      const receiptLines: PostLineInput[] = paymentLines.map((p) => ({
        accountId: p.accountId,
        debitAmount: p.amount,
        description: `Payment received for ${invoiceNumber}`,
      }));
      receiptLines.push({ accountId: arId, creditAmount: paid, description: `Payment received for ${invoiceNumber}` });

      const receiptEntry = await postJournalEntry({
        tenantId: session.tenantId,
        entryDate: input.invoiceDate,
        sourceType: "receipt",
        sourceId: invoice.id,
        referenceNumber: invoiceNumber,
        memo: `Payment received for ${invoiceNumber}`,
        createdBy: session.userId,
        lines: receiptLines,
      });

      await ensureBankAccount(session.tenantId, paymentLines[0].accountId);
      await insertEmbeddedCustomerPayment(
        session.tenantId,
        session.userId,
        input.customerId,
        invoice.id,
        input.invoiceDate,
        paid,
        paymentLines[0].accountId,
        receiptEntry.id,
        invoiceNumber
      );
    }
  } catch (e) {
    if (stockApplied) await applyStockDelta(session.tenantId, validLines, 1).catch(() => {});
    await discardInvoice(session.tenantId, invoice.id, session.userId);
    throw e;
  }

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
  revalidatePath("/inventory/items");
}
