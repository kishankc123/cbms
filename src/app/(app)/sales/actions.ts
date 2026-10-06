"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, or, desc, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  salesInvoices,
  journalEntries,
  journalLines,
  type LineItem,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateCustomerReceivableAccountId } from "@/lib/ledger/subledger-accounts";
import { assertInventoryDate, assertItemsUsable, assertStockAvailable, moveStock, unwindStock } from "@/lib/inventory/stock";
import { recalculateAfter } from "@/lib/inventory/recalc";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { autoApplyAdvance, getAdvanceInfo, applyAdvance, unapplyAdvance } from "@/lib/ledger/advance-applications";
import { salesVatRate } from "@/lib/sales/vat";
import { resolveRevenueLines } from "@/lib/sales/revenue-accounts";
import { assertCashBankAccounts, assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { todayIso } from "@/lib/calendar";
import {
  PartialBatchError,
  deleteEmbeddedPaymentsForInvoice,
  discardInvoice,
  ensureBankAccount,
  insertEmbeddedCustomerPayment,
  postSalesBatch,
  takenInvoiceNumbers,
  type BatchInvoiceRow,
  type BatchPaymentLine,
  type SalesBillType,
} from "@/lib/sales/invoice-records";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function assertInvoiceNumberFree(tenantId: string, invoiceNumber: string, excludeInvoiceId?: string) {
  if ((await takenInvoiceNumbers(tenantId, excludeInvoiceId)).has(invoiceNumber)) throw new Error(`Invoice number ${invoiceNumber} is already used`);
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
    .where(and(where, isNull(journalEntries.reversalOfId))) // a reversal is never itself reversed
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
  cost: number
) {
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

export type { BatchPaymentLine, BatchInvoiceRow, SalesBillType } from "@/lib/sales/invoice-records";

// This is the only place the Multi-Invoice grid writes — the grid's RECORD PAY button only captures payment intent
// locally; nothing is persisted until this runs (triggered solely by the page's Save button). The writing itself is
// shared with Import Sales (lib/sales/invoice-records.ts).
export async function recordSalesBatch(input: { rows: BatchInvoiceRow[] }) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");
  try {
    await postSalesBatch({ tenantId: session.tenantId, userId: session.userId }, input.rows);
  } catch (e) {
    // The form reports a plain message, whether or not some earlier rows were already saved.
    if (e instanceof PartialBatchError) throw new Error(e.message);
    throw e;
  }

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
}

export async function voidInvoice(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "void")) throw new Error("Not permitted");

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
  await unwindStock(session.tenantId, { date: todayIso(), sourceType: "sale", sourceId: invoiceId, userId: session.userId });

  await db.update(salesInvoices).set({ status: "void" }).where(eq(salesInvoices.id, invoiceId));

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
  revalidatePath("/inventory/items");
  // Later sales were costed with these goods in the average — replay the history so they are costed right.
  await recalculateAfter(session.tenantId, ((invoice.lineItems ?? []) as LineItem[]).map((l) => l.itemId), session.userId, `Void of invoice ${invoice.invoiceNumber}`);
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
  billType: SalesBillType;
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
    billType: invoice.taxTreatment,
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

  const billType: SalesBillType = input.billType ?? "taxable";
  // The rate that applied on the invoice's OWN date, not today's — zero for a Zero-rated bill regardless.
  const vatRate = billType === "taxable" ? await salesVatRate(session.tenantId, input.invoiceDate) : 0;

  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const computed = validLines.map((l) => computeSingleLine(l, vatRate));
  const grossAmount = round2(computed.reduce((s, c) => s + c.gross, 0));
  const discountAmount = round2(computed.reduce((s, c) => s + c.discount, 0));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);
  // What is taken out of stock must be there (counting what this invoice already holds), unless negative stock is allowed.
  await assertItemsUsable(session.tenantId, validLines, { stillAllowed: ((existing.lineItems ?? []) as LineItem[]).map((l) => l.itemId) });
  await assertInventoryDate(session.tenantId, input.invoiceDate, validLines);
  await assertStockAvailable(session.tenantId, validLines, { date: input.invoiceDate, excludeSource: { sourceType: "sale", sourceId: input.invoiceId } });

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "sent";

  const arId = await getOrCreateCustomerReceivableAccountId(session.tenantId, input.customerId);
  // Each line posts to ITS OWN revenue account if it has one, else the shared default — never one aggregate
  // line, so a Product and a Service with different accounts both land correctly in the same entry.
  const revenueLines = await resolveRevenueLines(session.tenantId, validLines.map((l, i) => ({ itemId: l.itemId, amount: computed[i].taxable })));

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
  await unwindStock(session.tenantId, { date: existing.invoiceDate, sourceType: "sale", sourceId: input.invoiceId, userId: session.userId });
  const issued = await moveStock(
    session.tenantId,
    { type: "sale", date: input.invoiceDate, sourceType: "sale", sourceId: input.invoiceId, userId: session.userId },
    validLines.map((l) => ({ itemId: l.itemId, quantity: -l.quantity }))
  );

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
      taxTreatment: billType,
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      amountPaid: paid.toFixed(2),
      status,
    })
    .where(eq(salesInvoices.id, input.invoiceId));

  const lines: PostLineInput[] = [
    { accountId: arId, debitAmount: total, description: `Invoice ${invoiceNumber}` },
    ...revenueLines.map((r) => ({ accountId: r.accountId, creditAmount: r.amount, description: `Invoice ${invoiceNumber}` })),
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

  await postCogsEntry(session.tenantId, input.invoiceDate, input.invoiceId, invoiceNumber, session.userId, Math.abs(issued.value));

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
  await recalculateAfter(session.tenantId, [...validLines, ...((existing.lineItems ?? []) as LineItem[])].map((l) => l.itemId), session.userId, `Edit of invoice ${invoiceNumber}`);
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
  billType?: SalesBillType;
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

  const billType: SalesBillType = input.billType ?? "taxable";
  // The rate that applied on the invoice's OWN date, not today's — zero for a Zero-rated bill regardless.
  const vatRate = billType === "taxable" ? await salesVatRate(session.tenantId, input.invoiceDate) : 0;

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
  // What is sold must be in stock, unless the organization allows negative stock.
  await assertItemsUsable(session.tenantId, validLines);
  await assertInventoryDate(session.tenantId, input.invoiceDate, validLines);
  await assertStockAvailable(session.tenantId, validLines, { date: input.invoiceDate });

  const arId = await getOrCreateCustomerReceivableAccountId(session.tenantId, input.customerId);
  // Each line posts to ITS OWN revenue account if it has one, else the shared default — never one aggregate
  // line, so a Product and a Service with different accounts both land correctly in the same entry.
  const revenueLines = await resolveRevenueLines(session.tenantId, validLines.map((l, i) => ({ itemId: l.itemId, amount: computed[i].taxable })));

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
      taxTreatment: billType,
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
      ...revenueLines.map((r) => ({ accountId: r.accountId, creditAmount: r.amount, description: `Invoice ${invoiceNumber}` })),
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

    // The goods leave stock at their average cost; that cost is the cost of goods sold.
    const issued = await moveStock(
      session.tenantId,
      { type: "sale", date: input.invoiceDate, sourceType: "sale", sourceId: invoice.id, userId: session.userId },
      validLines.map((l) => ({ itemId: l.itemId, quantity: -l.quantity }))
    );
    stockApplied = true;
    await postCogsEntry(session.tenantId, input.invoiceDate, invoice.id, invoiceNumber, session.userId, Math.abs(issued.value));

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
    if (stockApplied) await unwindStock(session.tenantId, { date: input.invoiceDate, sourceType: "sale", sourceId: invoice.id, userId: session.userId }).catch(() => {});
    await discardInvoice(session.tenantId, invoice.id, session.userId);
    throw e;
  }

  // Any advance this customer has paid goes to their oldest open invoices first.
  await autoApplyAdvance(session.tenantId, session.userId, "customer", input.customerId);

  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/customers");
  revalidatePath("/inventory/items");
  await recalculateAfter(session.tenantId, validLines.map((l) => l.itemId), session.userId, `Invoice ${invoiceNumber}`);
}

// ---- applying a customer's advance to one invoice by hand (it is also applied automatically when an invoice is created)

export async function getInvoiceAdvance(invoiceId: string) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "view")) throw new Error("Not permitted");
  return getAdvanceInfo(session.tenantId, "customer", invoiceId);
}

export async function applyInvoiceAdvance(invoiceId: string, amount: number) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");
  await applyAdvance(session.tenantId, session.userId, "customer", invoiceId, amount);
  for (const p of ["/sales", "/customers", "/journal", "/payments", "/dashboard"]) revalidatePath(p);
}

export async function removeInvoiceAdvance(applicationId: string) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");
  await unapplyAdvance(session.tenantId, session.userId, "customer", applicationId);
  for (const p of ["/sales", "/customers", "/journal", "/payments", "/dashboard"]) revalidatePath(p);
}
