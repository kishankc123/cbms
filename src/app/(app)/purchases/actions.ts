"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { purchaseBills, vendors, journalEntries, journalLines, type PurchaseLineItem } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { allocateProportional, assertInventoryDate, assertItemsUsable, assertStockTimeline, moveStock, unwindStock } from "@/lib/inventory/stock";
import { recalculateAfter } from "@/lib/inventory/recalc";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertCashBankAccounts, assertSupplierOwned, assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { todayIso } from "@/lib/calendar";
import { autoApplyAdvance, getAdvanceInfo, applyAdvance, unapplyAdvance } from "@/lib/ledger/advance-applications";
import { assertBillNumberFree, deleteEmbeddedPaymentsForBill, discardBill, insertEmbeddedSupplierPayment, nextAutoBillNumber } from "@/lib/purchases/bill-records";
import { invoiceRequirements } from "@/lib/purchases/invoice-requirements";
import {
  billLineItems,
  cashPurchaseEntryLines,
  createCashPurchaseCore,
  prepareCashPurchase,
  taxReceivableIdIfClaimed,
  type CashBillType,
  type CashPaymentLine,
  type CashPurchaseInput,
  type CashPurchaseLine,
} from "@/lib/purchases/cash-purchase";

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
        eq(journalEntries.isReversed, false),
        isNull(journalEntries.reversalOfId) // a reversal is never itself reversed
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

export type { CashBillType, CashPaymentLine, CashPurchaseLine, CashPurchaseInput } from "@/lib/purchases/cash-purchase";

// One consumable bill per Save. The writing itself is shared with Import Purchases (lib/purchases/cash-purchase.ts).
export async function createCashPurchase(input: CashPurchaseInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  await createCashPurchaseCore({ tenantId: session.tenantId, userId: session.userId }, input);

  revalidatePath("/purchases/consumable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export type UpdateCashPurchaseInput = CashPurchaseInput & { billId: string };

// Editing a posted consumable purchase reverses its old entry and posts a fresh one from the updated fields,
// rather than trying to diff the change — same correction pattern used everywhere else in the ledger.
export async function updateCashPurchase(input: UpdateCashPurchaseInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const [existing] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, input.billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Bill not found");
  if (existing.purchaseType === "asset") throw new Error("This is an asset purchase and can't be edited here. Void it from the asset's page in Assets and enter it again.");
  if (existing.status === "void") throw new Error("Cannot edit a void bill");
  if (!input.billDate) throw new Error("Bill date is required");

  const prepared = await prepareCashPurchase(session.tenantId, input);
  const vendorId = input.vendorId || null;
  const billNumber = input.billNumber.trim() || existing.billNumber;

  // Everything is checked before the old entry is reversed, so a refusal leaves the bill untouched.
  await assertNoLaterPayments(session.tenantId, "purchase_bill", input.billId, "bill");
  await assertBillNumberFree(session.tenantId, vendorId, billNumber, input.billId);
  await assertPeriodOpen(session.tenantId, input.billDate);
  await assertPeriodOpen(session.tenantId, todayIso());
  const taxReceivableId = await taxReceivableIdIfClaimed(session.tenantId, prepared.tax);

  const payable = prepared.remaining > 0 && vendorId ? { accountId: await getOrCreateSupplierPayableAccountId(session.tenantId, vendorId), amount: prepared.remaining } : null;

  await reverseActiveEntry(session.tenantId, input.billId, session.userId, `Edit of bill ${existing.billNumber}`);
  await deleteEmbeddedPaymentsForBill(session.tenantId, input.billId);

  await db
    .update(purchaseBills)
    .set({
      vendorId,
      billNumber,
      billDate: input.billDate,
      billType: input.billType,
      description: prepared.description,
      lineItems: billLineItems(prepared.computed),
      subtotal: prepared.subtotal.toFixed(2),
      taxAmount: prepared.tax.toFixed(2),
      total: prepared.total.toFixed(2),
      status: prepared.status,
      amountPaid: prepared.paid.toFixed(2),
      ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}),
    })
    .where(eq(purchaseBills.id, input.billId));

  const entry = await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.billDate,
    sourceType: "purchase",
    sourceId: input.billId,
    referenceNumber: billNumber,
    memo: `Consumable purchase ${billNumber} (edited)`,
    createdBy: session.userId,
    lines: cashPurchaseEntryLines(prepared.computed, prepared.tax, taxReceivableId, billNumber, input.payments, payable),
  });
  if (prepared.paid > 0) {
    const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
    await insertEmbeddedSupplierPayment(session.tenantId, session.userId, vendorId, input.billId, input.billDate, prepared.paid, paymentLines[0].accountId, entry.id, billNumber, paymentLines[0].modeId);
  }
  if (vendorId) await autoApplyAdvance(session.tenantId, session.userId, "supplier", vendorId);

  revalidatePath("/purchases/consumable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
}

export type CashPurchaseEditData = {
  billId: string;
  billNumber: string;
  billDate: string;
  vendorId: string | null;
  billType: CashBillType;
  billAvailable: boolean | null;
  lines: CashPurchaseLine[];
  payments: CashPaymentLine[];
};

// Bills saved with the newer form carry their lines. Older ones (one category, one amount) are rebuilt as a
// single line from the bill and its journal entry.
export async function getCashPurchaseForEdit(billId: string): Promise<CashPurchaseEditData> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");

  const [bill] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!bill) throw new Error("Bill not found");

  const entryLines = await activeEntryLines(session.tenantId, billId);
  const taxReceivable = await findControlAccount(session.tenantId, ["1300"], "Tax Receivable");
  // The credit to the supplier's payable account is the unpaid balance, not a payment.
  const [supplier] = bill.vendorId ? await db.select({ payableAccountId: vendors.payableAccountId }).from(vendors).where(eq(vendors.id, bill.vendorId)).limit(1) : [];
  const payments = entryLines
    .filter((l) => Number(l.creditAmount) > 0 && l.accountId !== supplier?.payableAccountId)
    .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount), modeId: l.paymentModeId }));

  const stored = (bill.lineItems ?? []).filter((l) => l.categoryId);
  let lines: CashPurchaseLine[];
  if (stored.length > 0) {
    lines = stored.map((l) => ({ description: l.description, categoryId: l.categoryId as string, rate: l.rate, quantity: l.quantity, discount: l.discount }));
  } else {
    const categoryLine = entryLines.find((l) => Number(l.debitAmount) > 0 && l.accountId !== taxReceivable?.id);
    lines = [{ description: bill.description ?? "", categoryId: categoryLine?.accountId ?? "", rate: Number(bill.subtotal), quantity: 1, discount: 0 }];
  }

  return {
    billId: bill.id,
    billNumber: bill.billNumber,
    billDate: bill.billDate,
    vendorId: bill.vendorId,
    billType: bill.billType as CashBillType,
    billAvailable: bill.billAvailable,
    lines,
    payments,
  };
}

export async function voidBill(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "void")) throw new Error("Not permitted");

  const billId = String(formData.get("billId"));

  const [bill] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!bill) throw new Error("Bill not found");
  if (bill.purchaseType === "asset") throw new Error("This is an asset purchase. Void it from the asset's page in Assets.");
  if (bill.status === "void") throw new Error("Bill is already void");

  await assertNoLaterPayments(session.tenantId, "purchase_bill", billId, "bill");
  // Voiding takes the goods back out — at no point since their date may that leave less than nothing.
  await assertStockTimeline(session.tenantId, { excludeSource: { sourceType: "purchase", sourceId: billId } });

  await reverseActiveEntry(session.tenantId, billId, session.userId, `Void of bill ${bill.billNumber}`);
  await deleteEmbeddedPaymentsForBill(session.tenantId, billId);
  await unwindStock(session.tenantId, { date: todayIso(), sourceType: "purchase", sourceId: billId, userId: session.userId });

  await db.update(purchaseBills).set({ status: "void" }).where(eq(purchaseBills.id, billId));

  revalidatePath("/purchases/consumable");
  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/inventory/items");
  revalidatePath("/journal");
  // Later sales were costed with these goods in the average — replay the history so they are costed right.
  await recalculateAfter(session.tenantId, (bill.lineItems ?? []).map((l) => l.itemId), session.userId, `Void of bill ${bill.billNumber}`);
}

export type PurchaseInvoicePayment = { accountId: string; amount: number; modeId?: string | null };

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
async function computeInvoiceTotals(tenantId: string, lines: PurchaseLineItem[], billType: CashBillType, invoiceDate: string) {
  // Taxed at the rate that applied on the invoice's OWN date, not today's.
  const vatRate = billType === "vat" ? await getTaxRate(tenantId, "vat", invoiceDate) : 0;

  const validLines = lines.filter((l) => l.quantity > 0 && l.rate > 0);
  const computed = validLines.map((l) => computeInvoiceLine(l, vatRate));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  return { validLines, computed, subtotal, taxAmount, total };
}

// Stockable purchases post to Inventory (an asset), not straight to an
// expense account — the goods are being stocked, not consumed.
async function buildInvoiceJournalLines(
  tenantId: string,
  vendorId: string | null,
  invoiceLabel: string,
  subtotal: number,
  taxAmount: number,
  remaining: number,
  payments: PurchaseInvoicePayment[],
  claimable: boolean
): Promise<PostLineInput[]> {
  const inventory = await findControlAccount(tenantId, ["1200"], "Inventory");
  if (!inventory) throw new Error("No Inventory account found — add one to the Chart of Accounts first");

  // Without a VAT registration the VAT is part of the cost of the goods, not a claim.
  const lines: PostLineInput[] = [
    { accountId: inventory.id, debitAmount: claimable ? subtotal : round2(subtotal + taxAmount), description: `Invoice ${invoiceLabel}` },
  ];

  if (taxAmount > 0 && claimable) {
    const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
    if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
    lines.push({ accountId: taxReceivable.id, debitAmount: taxAmount, description: `Tax on invoice ${invoiceLabel}` });
  }

  if (remaining > 0) {
    if (!vendorId) throw new Error("Select a supplier: the unpaid balance is owed to them");
    const apId = await getOrCreateSupplierPayableAccountId(tenantId, vendorId);
    lines.push({ accountId: apId, creditAmount: remaining, description: `Invoice ${invoiceLabel}` });
  }

  for (const p of payments.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: p.accountId, paymentModeId: p.modeId, creditAmount: round2(p.amount), description: `Invoice ${invoiceLabel}` });
  }

  return lines;
}

// What each stocked line adds to the Inventory account: its taxable amount, plus its share of the VAT when the VAT can't be claimed
// back (it is then part of the cost). The parts add up to exactly what the entry debits Inventory with.
function inventoryValues(computed: { taxable: number; vat: number }[], subtotal: number, taxAmount: number, claimable: boolean) {
  return allocateProportional(claimable ? subtotal : round2(subtotal + taxAmount), computed.map((c) => (claimable ? c.taxable : c.taxable + c.vat)));
}

export type PurchaseInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  vendorId: string;
  billType: CashBillType;
  dueDate?: string | null;
  billAvailable?: boolean;
  lines: PurchaseLineItem[];
  payments: PurchaseInvoicePayment[];
};

// A Stockable purchase invoice is a single vendor bill with multiple item
// lines — unlike the Consumable batch grid, this creates exactly one bill
// per Save.
export async function createPurchaseInvoice(input: PurchaseInvoiceInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  if (!input.invoiceDate) throw new Error("Invoice date is required");
  if (input.dueDate && input.dueDate < input.invoiceDate) throw new Error("The due date can't be before the invoice date");

  const { validLines, computed, subtotal, taxAmount, total } = await computeInvoiceTotals(session.tenantId, input.lines, input.billType, input.invoiceDate);
  if (validLines.length === 0) throw new Error("Add at least one item line");
  await assertItemsUsable(session.tenantId, validLines, { requireItem: true });
  await assertInventoryDate(session.tenantId, input.invoiceDate, validLines);

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const remaining = round2(Math.max(total - paid, 0));
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";

  // A non-VAT bill paid in full needs no supplier and no invoice number (one is generated); a VAT bill or an unpaid balance does.
  const needs = invoiceRequirements({ billType: input.billType, total, paid });
  const vendorId = input.vendorId || null;
  let invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber && needs.numberRequired) throw new Error(`Invoice number is required: ${needs.reason}`);
  if (!vendorId && needs.supplierRequired) throw new Error(`Select a supplier: ${needs.reason}`);
  if (!invoiceNumber) invoiceNumber = await nextAutoBillNumber(session.tenantId);

  // Everything is checked before anything is saved.
  if (vendorId) await assertSupplierOwned(session.tenantId, vendorId);
  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertBillNumberFree(session.tenantId, vendorId, invoiceNumber);
  await assertPeriodOpen(session.tenantId, input.invoiceDate);

  const claimable = await inputVatClaimable(session.tenantId);
  const stockValues = inventoryValues(computed, subtotal, taxAmount, claimable);
  const journalLines = await buildInvoiceJournalLines(
    session.tenantId,
    vendorId,
    invoiceNumber,
    subtotal,
    taxAmount,
    remaining,
    input.payments,
    claimable
  );

  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId: session.tenantId,
      vendorId,
      billNumber: invoiceNumber,
      billDate: input.invoiceDate,
      dueDate: input.dueDate || null,
      billType: input.billType,
      lineItems: validLines,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      purchaseType: "credit",
      status,
      amountPaid: paid.toFixed(2),
      billAvailable: input.billAvailable ?? null,
    })
    .returning();

  let stockApplied = false;
  try {
    const entry = await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.invoiceDate,
      sourceType: "purchase",
      sourceId: bill.id,
      referenceNumber: invoiceNumber,
      memo: `Stockable purchase ${invoiceNumber}`,
      createdBy: session.userId,
      lines: journalLines,
    });
    await moveStock(
      session.tenantId,
      { type: "purchase", date: input.invoiceDate, sourceType: "purchase", sourceId: bill.id, userId: session.userId },
      validLines.map((l, i) => ({ itemId: l.itemId, quantity: l.quantity, value: stockValues[i] }))
    );
    stockApplied = true;

    if (paid > 0) {
      const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
      await insertEmbeddedSupplierPayment(session.tenantId, session.userId, vendorId, bill.id, input.invoiceDate, paid, paymentLines[0].accountId, entry.id, invoiceNumber, paymentLines[0].modeId);
    }
  } catch (e) {
    if (stockApplied) await unwindStock(session.tenantId, { date: input.invoiceDate, sourceType: "purchase", sourceId: bill.id, userId: session.userId }, { allowNegative: true }).catch(() => {});
    await discardBill(session.tenantId, bill.id, session.userId);
    throw e;
  }

  // Any advance paid to this supplier goes to their oldest open bills first.
  if (vendorId) await autoApplyAdvance(session.tenantId, session.userId, "supplier", vendorId);

  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/journal");
  revalidatePath("/inventory/items");
  await recalculateAfter(session.tenantId, validLines.map((l) => l.itemId), session.userId, `Purchase ${invoiceNumber}`);
}

export type PurchaseInvoiceEditData = {
  billId: string;
  invoiceNumber: string;
  invoiceDate: string;
  vendorId: string;
  dueDate: string | null;
  billAvailable: boolean | null;
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
  const apId = bill.vendorId ? await getOrCreateSupplierPayableAccountId(session.tenantId, bill.vendorId) : null;

  const payments = lines
    .filter((l) => Number(l.creditAmount) > 0 && l.accountId !== apId)
    .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount), modeId: l.paymentModeId }));

  return {
    billId: bill.id,
    invoiceNumber: bill.billNumber,
    invoiceDate: bill.billDate,
    vendorId: bill.vendorId ?? "",
    dueDate: bill.dueDate,
    billAvailable: bill.billAvailable,
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

  if (!input.invoiceDate) throw new Error("Invoice date is required");
  if (input.dueDate && input.dueDate < input.invoiceDate) throw new Error("The due date can't be before the invoice date");

  const { validLines, computed, subtotal, taxAmount, total } = await computeInvoiceTotals(session.tenantId, input.lines, input.billType, input.invoiceDate);
  if (validLines.length === 0) throw new Error("Add at least one item line");
  await assertItemsUsable(session.tenantId, validLines, { requireItem: true, stillAllowed: (existing.lineItems ?? []).map((l) => l.itemId) });

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const remaining = round2(Math.max(total - paid, 0));
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";

  // A non-VAT bill paid in full needs no supplier and no invoice number; a VAT bill or an unpaid balance does.
  const needs = invoiceRequirements({ billType: input.billType, total, paid });
  const vendorId = input.vendorId || null;
  const invoiceNumber = input.invoiceNumber.trim() || (needs.numberRequired ? "" : existing.billNumber);
  if (!invoiceNumber) throw new Error(`Invoice number is required: ${needs.reason}`);
  if (!vendorId && needs.supplierRequired) throw new Error(`Select a supplier: ${needs.reason}`);

  // Everything is checked before the old entry is reversed, so a refusal leaves the invoice untouched.
  await assertNoLaterPayments(session.tenantId, "purchase_bill", input.billId, "bill");
  if (vendorId) await assertSupplierOwned(session.tenantId, vendorId);
  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertBillNumberFree(session.tenantId, vendorId, invoiceNumber, input.billId);
  await assertPeriodOpen(session.tenantId, input.invoiceDate);
  await assertPeriodOpen(session.tenantId, todayIso());
  // Shrinking the purchase takes stock out: only what is still on hand can go.
  await assertInventoryDate(session.tenantId, input.invoiceDate, validLines);
  await assertStockTimeline(session.tenantId, { excludeSource: { sourceType: "purchase", sourceId: input.billId }, add: validLines.map((l) => ({ itemId: l.itemId, date: input.invoiceDate, quantity: l.quantity })) });

  const claimable = await inputVatClaimable(session.tenantId);
  const stockValues = inventoryValues(computed, subtotal, taxAmount, claimable);
  const journalLines = await buildInvoiceJournalLines(
    session.tenantId,
    vendorId,
    invoiceNumber,
    subtotal,
    taxAmount,
    remaining,
    input.payments,
    claimable
  );

  await reverseActiveEntry(session.tenantId, input.billId, session.userId, `Edit of invoice ${existing.billNumber}`);
  await deleteEmbeddedPaymentsForBill(session.tenantId, input.billId);
  await unwindStock(session.tenantId, { date: existing.billDate, sourceType: "purchase", sourceId: input.billId, userId: session.userId });
  await moveStock(
    session.tenantId,
    { type: "purchase", date: input.invoiceDate, sourceType: "purchase", sourceId: input.billId, userId: session.userId },
    validLines.map((l, i) => ({ itemId: l.itemId, quantity: l.quantity, value: stockValues[i] }))
  );

  await db
    .update(purchaseBills)
    .set({
      vendorId,
      billNumber: invoiceNumber,
      billDate: input.invoiceDate,
      dueDate: input.dueDate || null,
      billType: input.billType,
      lineItems: validLines,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      status,
      amountPaid: paid.toFixed(2),
      ...(input.billAvailable !== undefined ? { billAvailable: input.billAvailable } : {}),
    })
    .where(eq(purchaseBills.id, input.billId));

  const entry = await postJournalEntry({
    tenantId: session.tenantId,
    entryDate: input.invoiceDate,
    sourceType: "purchase",
    sourceId: input.billId,
    referenceNumber: invoiceNumber,
    memo: `Stockable purchase ${invoiceNumber} (edited)`,
    createdBy: session.userId,
    lines: journalLines,
  });

  if (paid > 0) {
    const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
    await insertEmbeddedSupplierPayment(session.tenantId, session.userId, vendorId, input.billId, input.invoiceDate, paid, paymentLines[0].accountId, entry.id, invoiceNumber, paymentLines[0].modeId);
  }

  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/inventory/items");
  revalidatePath("/journal");
  await recalculateAfter(session.tenantId, [...validLines, ...(existing.lineItems ?? [])].map((l) => l.itemId), session.userId, `Edit of invoice ${invoiceNumber}`);
}

// ---- applying an advance paid to a supplier to one bill by hand (it is also applied automatically when a bill is created)

export async function getBillAdvance(billId: string) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "view")) throw new Error("Not permitted");
  return getAdvanceInfo(session.tenantId, "supplier", billId);
}

export async function applyBillAdvance(billId: string, amount: number) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");
  await applyAdvance(session.tenantId, session.userId, "supplier", billId, amount);
  for (const p of ["/purchases/stockable", "/suppliers", "/journal", "/payments", "/dashboard"]) revalidatePath(p);
}

export async function removeBillAdvance(applicationId: string) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");
  await unapplyAdvance(session.tenantId, session.userId, "supplier", applicationId);
  for (const p of ["/purchases/stockable", "/suppliers", "/journal", "/payments", "/dashboard"]) revalidatePath(p);
}
