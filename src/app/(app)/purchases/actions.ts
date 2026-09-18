"use server";

import { revalidatePath } from "next/cache";
import { and, eq, count, desc } from "drizzle-orm";
import { db } from "@/db";
import { purchaseBills, journalEntries, journalLines, tenants, type PurchaseLineItem } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { applyStockDelta } from "@/lib/inventory/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Finds the entry currently in force for a bill (i.e. not superseded by a
// reversal) and reverses it — used by both void and edit, since editing a
// posted bill means reversing the old entry and posting a fresh one.
async function reverseActiveEntry(tenantId: string, billId: string, userId: string, memo: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, "purchase"),
        eq(journalEntries.sourceId, billId),
        eq(journalEntries.isReversed, false)
      )
    )
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);

  if (entry) {
    await reverseJournalEntry(tenantId, entry.id, userId, memo);
  }
}

// Returns the journal lines of a bill's currently active entry — used to
// reconstruct the payment split when opening a bill for editing, since
// purchase_bills itself only stores the aggregate amountPaid.
async function activeEntryLines(tenantId: string, billId: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, "purchase"),
        eq(journalEntries.sourceId, billId),
        eq(journalEntries.isReversed, false)
      )
    )
    .orderBy(desc(journalEntries.createdAt))
    .limit(1);

  if (!entry) return [];
  return db.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
}

export type CashBillType = "vat" | "pan" | "estimate" | "challan" | "no_bill";

export type CashPurchaseRow = {
  billNumber: string;
  billDate: string;
  vendorId: string;
  categoryId: string;
  billType: CashBillType;
  description: string;
  amount: number;
  payments: { accountId: string; amount: number }[];
};

function isCashRowComplete(r: CashPurchaseRow) {
  return Boolean(
    r.billDate && r.categoryId && r.amount > 0 && r.payments.length > 0 && r.payments.every((p) => p.accountId && p.amount > 0)
  );
}

// VAT only applies when a row's bill type is VAT — any other bill type books
// the entered amount as-is, with no tax added.
function computeCashRowTax(amount: number, billType: CashBillType, vatRate: number) {
  const tax = billType === "vat" ? round2(amount * (vatRate / 100)) : 0;
  return { tax, total: round2(amount + tax) };
}

// Each row in the grid is its own independent cash purchase — settled
// immediately, no Accounts Payable involved, mirroring how the Sales
// invoice-wise grid treats every row as a separate transaction.
export async function createCashPurchaseBatch(input: { rows: CashPurchaseRow[] }) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  const validRows = input.rows.filter(isCashRowComplete);
  if (validRows.length === 0) throw new Error("Add at least one purchase row");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  let taxReceivableId: string | null = null;
  if (validRows.some((r) => r.billType === "vat")) {
    const taxReceivable = await findControlAccount(session.tenantId, ["1300"], "Tax Receivable");
    if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
    taxReceivableId = taxReceivable.id;
  }

  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, session.tenantId), eq(purchaseBills.purchaseType, "cash")));
  let nextSequence = existingCount + 1;

  for (const row of validRows) {
    const amount = round2(row.amount);
    const { tax, total } = computeCashRowTax(amount, row.billType, vatRate);
    const vendorId = row.vendorId || null;
    const billNumber = row.billNumber.trim() || `AUTO-${nextSequence++}`;

    const [bill] = await db
      .insert(purchaseBills)
      .values({
        tenantId: session.tenantId,
        vendorId,
        billNumber,
        billDate: row.billDate,
        billType: row.billType,
        description: row.description.trim() || null,
        subtotal: amount.toFixed(2),
        taxAmount: tax.toFixed(2),
        total: total.toFixed(2),
        purchaseType: "cash",
        status: "paid",
        amountPaid: total.toFixed(2),
      })
      .returning();

    const lines: PostLineInput[] = [
      { accountId: row.categoryId, debitAmount: amount, description: row.description.trim() || `Bill ${billNumber}` },
    ];
    if (tax > 0 && taxReceivableId) {
      lines.push({ accountId: taxReceivableId, debitAmount: tax, description: `Tax on bill ${billNumber}` });
    }
    for (const payment of row.payments) {
      lines.push({ accountId: payment.accountId, creditAmount: round2(payment.amount), description: `Bill ${billNumber}` });
    }

    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: row.billDate,
      sourceType: "purchase",
      sourceId: bill.id,
      referenceNumber: billNumber,
      memo: `Consumable purchase ${billNumber}`,
      createdBy: session.userId,
      lines,
    });
  }

  revalidatePath("/purchases/consumable");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export type UpdateCashPurchaseInput = {
  billId: string;
  billNumber: string;
  billDate: string;
  vendorId: string;
  categoryId: string;
  billType: CashBillType;
  description: string;
  amount: number;
  payments: { accountId: string; amount: number }[];
};

// Editing a posted consumable purchase reverses its old entry and posts a
// fresh one from the updated fields, rather than trying to diff the change —
// same correction pattern used everywhere else in the ledger.
export async function updateCashPurchase(input: UpdateCashPurchaseInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, input.billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Bill not found");
  if (existing.status === "void") throw new Error("Cannot edit a void bill");

  if (!input.categoryId || input.amount <= 0 || input.payments.length === 0) {
    throw new Error("Category, amount, and payment are required");
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const vatRate = parseFloat(tenant?.vatRate ?? "0") || 0;

  const amount = round2(input.amount);
  const { tax, total } = computeCashRowTax(amount, input.billType, vatRate);
  const vendorId = input.vendorId || null;
  const billNumber = input.billNumber.trim() || existing.billNumber;

  let taxReceivableId: string | null = null;
  if (tax > 0) {
    const taxReceivable = await findControlAccount(session.tenantId, ["1300"], "Tax Receivable");
    if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
    taxReceivableId = taxReceivable.id;
  }

  await reverseActiveEntry(session.tenantId, input.billId, session.userId, `Edit of bill ${existing.billNumber}`);

  await db
    .update(purchaseBills)
    .set({
      vendorId,
      billNumber,
      billDate: input.billDate,
      billType: input.billType,
      description: input.description.trim() || null,
      subtotal: amount.toFixed(2),
      taxAmount: tax.toFixed(2),
      total: total.toFixed(2),
      amountPaid: total.toFixed(2),
    })
    .where(eq(purchaseBills.id, input.billId));

  const lines: PostLineInput[] = [
    { accountId: input.categoryId, debitAmount: amount, description: input.description.trim() || `Bill ${billNumber}` },
  ];
  if (tax > 0 && taxReceivableId) {
    lines.push({ accountId: taxReceivableId, debitAmount: tax, description: `Tax on bill ${billNumber}` });
  }
  for (const payment of input.payments) {
    lines.push({ accountId: payment.accountId, creditAmount: round2(payment.amount), description: `Bill ${billNumber}` });
  }

  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.billDate,
    sourceType: "purchase",
    sourceId: input.billId,
    referenceNumber: billNumber,
    memo: `Consumable purchase ${billNumber} (edited)`,
    createdBy: session.userId,
    lines,
  });

  revalidatePath("/purchases/consumable");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export type CashPurchaseEditData = {
  billId: string;
  billNumber: string;
  billDate: string;
  vendorId: string | null;
  categoryId: string;
  billType: CashBillType;
  description: string;
  amount: number;
  payments: { accountId: string; amount: number }[];
};

// Purchase_bills only stores the aggregate amount, so the category and
// payment split are reconstructed from the bill's active journal entry.
export async function getCashPurchaseForEdit(billId: string): Promise<CashPurchaseEditData> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const [bill] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!bill) throw new Error("Bill not found");

  const lines = await activeEntryLines(session.tenantId, billId);
  const taxReceivable = await findControlAccount(session.tenantId, ["1300"], "Tax Receivable");

  const categoryLine = lines.find((l) => Number(l.debitAmount) > 0 && l.accountId !== taxReceivable?.id);
  const payments = lines
    .filter((l) => Number(l.creditAmount) > 0)
    .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount) }));

  return {
    billId: bill.id,
    billNumber: bill.billNumber,
    billDate: bill.billDate,
    vendorId: bill.vendorId,
    categoryId: categoryLine?.accountId ?? "",
    billType: bill.billType as CashBillType,
    description: bill.description ?? "",
    amount: Number(bill.subtotal),
    payments,
  };
}

export async function voidBill(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "delete")) throw new Error("Not permitted");

  const billId = String(formData.get("billId"));

  const [bill] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!bill) throw new Error("Bill not found");
  if (bill.status === "void") throw new Error("Bill is already void");

  await reverseActiveEntry(session.tenantId, billId, session.userId, `Void of bill ${bill.billNumber}`);
  await applyStockDelta(session.tenantId, bill.lineItems ?? [], -1);

  await db.update(purchaseBills).set({ status: "void" }).where(eq(purchaseBills.id, billId));

  revalidatePath("/purchases/consumable");
  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/inventory/items");
  revalidatePath("/journal");
}

export type PurchaseInvoicePayment = { accountId: string; amount: number };

function computeInvoiceLine(line: PurchaseLineItem, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  const total = round2(taxable + vat);
  return { gross, discount, taxable, vat, total };
}

// VAT only applies when the invoice is marked as a VAT bill — a PAN,
// Estimate, or No bill invoice books the taxable amount with no VAT line.
async function computeInvoiceTotals(tenantId: string, lines: PurchaseLineItem[], billType: CashBillType) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const vatRate = billType === "vat" ? parseFloat(tenant?.vatRate ?? "0") || 0 : 0;

  const validLines = lines.filter((l) => l.quantity > 0 && l.rate > 0);
  const computed = validLines.map((l) => computeInvoiceLine(l, vatRate));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  return { validLines, subtotal, taxAmount, total };
}

// Stockable purchases post to Inventory (an asset), not straight to an
// expense account — the goods are being stocked, not consumed.
async function buildInvoiceJournalLines(
  tenantId: string,
  invoiceLabel: string,
  subtotal: number,
  taxAmount: number,
  remaining: number,
  payments: PurchaseInvoicePayment[]
): Promise<PostLineInput[]> {
  const inventory = await findControlAccount(tenantId, ["1200"], "Inventory");
  if (!inventory) throw new Error("No Inventory account found — add one to the Chart of Accounts first");

  const lines: PostLineInput[] = [
    { accountId: inventory.id, debitAmount: subtotal, description: `Invoice ${invoiceLabel}` },
  ];

  if (taxAmount > 0) {
    const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
    if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
    lines.push({ accountId: taxReceivable.id, debitAmount: taxAmount, description: `Tax on invoice ${invoiceLabel}` });
  }

  if (remaining > 0) {
    const ap = await findControlAccount(tenantId, ["2000"], "Accounts Payable");
    if (!ap) throw new Error("No Accounts Payable account found — add one to the Chart of Accounts first");
    lines.push({ accountId: ap.id, creditAmount: remaining, description: `Invoice ${invoiceLabel}` });
  }

  for (const p of payments.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: p.accountId, creditAmount: round2(p.amount), description: `Invoice ${invoiceLabel}` });
  }

  return lines;
}

export type PurchaseInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  vendorId: string;
  billType: CashBillType;
  lines: PurchaseLineItem[];
  payments: PurchaseInvoicePayment[];
};

// A Stockable purchase invoice is a single vendor bill with multiple item
// lines — unlike the Consumable batch grid, this creates exactly one bill
// per Save.
export async function createPurchaseInvoice(input: PurchaseInvoiceInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (!input.vendorId) throw new Error("Select a supplier");
  if (!input.invoiceDate) throw new Error("Invoice date is required");

  const { validLines, subtotal, taxAmount, total } = await computeInvoiceTotals(session.tenantId, input.lines, input.billType);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const remaining = round2(Math.max(total - paid, 0));
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";

  const journalLines = await buildInvoiceJournalLines(session.tenantId, invoiceNumber, subtotal, taxAmount, remaining, input.payments);

  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId: session.tenantId,
      vendorId: input.vendorId,
      billNumber: invoiceNumber,
      billDate: input.invoiceDate,
      billType: input.billType,
      lineItems: validLines,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      purchaseType: "credit",
      status,
      amountPaid: paid.toFixed(2),
    })
    .returning();

  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.invoiceDate,
    sourceType: "purchase",
    sourceId: bill.id,
    referenceNumber: invoiceNumber,
    memo: `Stockable purchase ${invoiceNumber}`,
    createdBy: session.userId,
    lines: journalLines,
  });
  await applyStockDelta(session.tenantId, validLines, 1);

  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/inventory/items");
}

export type PurchaseInvoiceEditData = {
  billId: string;
  invoiceNumber: string;
  invoiceDate: string;
  vendorId: string;
  billType: CashBillType;
  lineItems: PurchaseLineItem[];
  payments: PurchaseInvoicePayment[];
};

// Reconstructs the payment split (accounts credited besides Accounts
// Payable) from the invoice's active journal entry — purchase_bills only
// stores the aggregate amountPaid.
export async function getPurchaseInvoiceForEdit(billId: string): Promise<PurchaseInvoiceEditData> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const [bill] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!bill) throw new Error("Invoice not found");

  const lines = await activeEntryLines(session.tenantId, billId);
  const ap = await findControlAccount(session.tenantId, ["2000"], "Accounts Payable");

  const payments = lines
    .filter((l) => Number(l.creditAmount) > 0 && l.accountId !== ap?.id)
    .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount) }));

  return {
    billId: bill.id,
    invoiceNumber: bill.billNumber,
    invoiceDate: bill.billDate,
    vendorId: bill.vendorId ?? "",
    billType: bill.billType as CashBillType,
    lineItems: bill.lineItems as PurchaseLineItem[],
    payments,
  };
}

export type UpdatePurchaseInvoiceInput = PurchaseInvoiceInput & { billId: string };

export async function updatePurchaseInvoice(input: UpdatePurchaseInvoiceInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, input.billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Invoice not found");
  if (existing.status === "void") throw new Error("Cannot edit a void invoice");

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (!input.vendorId) throw new Error("Select a supplier");
  if (!input.invoiceDate) throw new Error("Invoice date is required");

  const { validLines, subtotal, taxAmount, total } = await computeInvoiceTotals(session.tenantId, input.lines, input.billType);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const remaining = round2(Math.max(total - paid, 0));
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";

  const journalLines = await buildInvoiceJournalLines(session.tenantId, invoiceNumber, subtotal, taxAmount, remaining, input.payments);

  await reverseActiveEntry(session.tenantId, input.billId, session.userId, `Edit of invoice ${existing.billNumber}`);
  await applyStockDelta(session.tenantId, existing.lineItems ?? [], -1);
  await applyStockDelta(session.tenantId, validLines, 1);

  await db
    .update(purchaseBills)
    .set({
      vendorId: input.vendorId,
      billNumber: invoiceNumber,
      billDate: input.invoiceDate,
      billType: input.billType,
      lineItems: validLines,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      status,
      amountPaid: paid.toFixed(2),
    })
    .where(eq(purchaseBills.id, input.billId));

  await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.invoiceDate,
    sourceType: "purchase",
    sourceId: input.billId,
    referenceNumber: invoiceNumber,
    memo: `Stockable purchase ${invoiceNumber} (edited)`,
    createdBy: session.userId,
    lines: journalLines,
  });

  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/inventory/items");
  revalidatePath("/journal");
}
