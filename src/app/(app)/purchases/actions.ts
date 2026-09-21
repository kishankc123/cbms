"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { purchaseBills, journalEntries, journalLines, tenants, payments, paymentAllocations, items, type PurchaseLineItem } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { applyStockDelta } from "@/lib/inventory/stock";
import { withPaymentNumber } from "@/lib/payment-number";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertCashBankAccounts, assertCogsCategory, assertSupplierOwned, assertNoLaterPayments } from "@/lib/ledger/account-guards";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { todayIso } from "@/lib/calendar";

// Deletes the embedded (paid-at-creation) Payment-module row(s) recorded
// for this bill, cascading to their allocation rows — called before a void
// or edit re-posts fresh entries.
async function deleteEmbeddedPaymentsForBill(tenantId: string, billId: string) {
  const rows = await db
    .select({ paymentId: paymentAllocations.paymentId })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "embedded"), eq(paymentAllocations.targetType, "purchase_bill"), eq(paymentAllocations.targetId, billId)));

  const paymentIds = [...new Set(rows.map((r) => r.paymentId))];
  for (const id of paymentIds) {
    await db.delete(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)));
  }
}

// Records the embedded supplier-payment row (+ its allocation to this bill)
// in the unified Payment module for a payment captured at bill
// creation/edit time — the accounting entry itself is posted separately by
// the caller, unchanged; this is purely the Payment module's own record of
// that same fact so it shows up in the Payments list and reconciliation.
async function insertEmbeddedSupplierPayment(
  tenantId: string,
  userId: string,
  vendorId: string | null,
  billId: string,
  paymentDate: string,
  amount: number,
  accountId: string,
  journalEntryId: string,
  referenceNumber: string
) {
  const [row] = await withPaymentNumber(tenantId, "money_out", (paymentNumber) =>
    db
    .insert(payments)
    .values({
      tenantId,
      paymentNumber,
      direction: "money_out",
      paymentType: "supplier_payment",
      paymentDate,
      partyType: vendorId ? "supplier" : "none",
      vendorId,
      accountId,
      paymentMethod: "cash",
      referenceNumber,
      amount: amount.toFixed(2),
      description: `Payment for ${referenceNumber}`,
      status: "posted",
      origin: "embedded",
      journalEntryId,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    })
    .returning()
  );

  await db.insert(paymentAllocations).values({ paymentId: row.id, targetType: "purchase_bill", targetId: billId, allocatedAmount: amount.toFixed(2) });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// A supplier's bill number is unique per supplier (two suppliers can both have a bill "101"). Void bills
// don't count, so a bill voided because of a typo can be entered again.
async function assertBillNumberFree(tenantId: string, vendorId: string | null, billNumber: string, excludeBillId?: string) {
  const rows = await db
    .select({ id: purchaseBills.id, vendorId: purchaseBills.vendorId })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.billNumber, billNumber), ne(purchaseBills.status, "void")));
  if (rows.some((r) => r.id !== excludeBillId && (r.vendorId ?? null) === (vendorId ?? null))) {
    throw new Error(`Bill number ${billNumber} is already recorded${vendorId ? " for this supplier" : ""}`);
  }
}

// A failed save must not leave half a bill behind: undo whatever posted and drop the row.
async function discardBill(tenantId: string, billId: string, userId: string) {
  await reverseAllActiveEntriesForSource(tenantId, billId, userId, "Rolled back — bill could not be saved").catch(() => {});
  await deleteEmbeddedPaymentsForBill(tenantId, billId).catch(() => {});
  await db.delete(purchaseBills).where(eq(purchaseBills.id, billId));
}

// Stock can't be taken out (by voiding or shrinking a purchase) beyond what is on hand — some of it has
// already been sold or returned.
async function assertStockCovers(tenantId: string, lines: { itemId?: string | null; quantity: number }[]) {
  const need = new Map<string, number>();
  for (const l of lines) if (l.itemId && l.quantity > 0) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.quantity);
  if (need.size === 0) return;
  const rows = await db.select({ id: items.id, name: items.name, qty: items.stockQuantity }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...need.keys()])));
  for (const r of rows) {
    if (Number(r.qty) < (need.get(r.id) ?? 0)) throw new Error(`Only ${Number(r.qty)} of ${r.name} in stock — some of this purchase has already been sold or returned`);
  }
}

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

export type CashPaymentLine = { accountId: string; amount: number };

// One line of a Consumable purchase: what was bought, and the purchase category it is booked to.
export type CashPurchaseLine = { description: string; categoryId: string; rate: number; quantity: number; discount: number };

// A Consumable purchase is ONE bill with one or more lines, settled in full at once — no Accounts Payable.
export type CashPurchaseInput = {
  billNumber: string;
  billDate: string;
  vendorId: string;
  billType: CashBillType;
  billAvailable?: boolean;
  lines: CashPurchaseLine[];
  payments: CashPaymentLine[];
};

function computeCashLine(line: CashPurchaseLine, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  return { gross, discount, taxable, vat };
}

// Checks everything about a consumable purchase before anything is saved or reversed, and works out the amounts.
// VAT applies only when the bill type is VAT; the payments must equal the bill total (VAT included).
async function prepareCashPurchase(tenantId: string, input: CashPurchaseInput, vatRateIfVat: number) {
  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one line with a rate and quantity");
  for (const categoryId of new Set(validLines.map((l) => l.categoryId))) await assertCogsCategory(tenantId, categoryId);

  const vatRate = input.billType === "vat" ? vatRateIfVat : 0;
  const computed = validLines.map((l) => ({ line: l, ...computeCashLine(l, vatRate) }));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const tax = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + tax);

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paid - total) > 0.004) throw new Error(`The payments (${paid.toFixed(2)}) must equal the bill total (${total.toFixed(2)}, VAT included)`);
  await assertCashBankAccounts(tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  if (input.vendorId) await assertSupplierOwned(tenantId, input.vendorId);

  const description = validLines.map((l) => l.description.trim()).filter(Boolean).join(", ").slice(0, 200) || null;
  return { computed, subtotal, tax, total, description };
}

// The ledger side of a consumable purchase: each category is debited its lines' taxable amount; the VAT is
// claimed (Tax Receivable) when the organization can claim it, otherwise it is part of the cost and goes to the
// categories with the lines it belongs to. The payments are credited.
function cashPurchaseEntryLines(
  computed: { line: CashPurchaseLine; taxable: number; vat: number }[],
  tax: number,
  taxReceivableId: string | null,
  billNumber: string,
  paymentList: CashPaymentLine[]
): PostLineInput[] {
  const claimTax = tax > 0 && taxReceivableId;
  const byCategory = new Map<string, number>();
  for (const c of computed) byCategory.set(c.line.categoryId, round2((byCategory.get(c.line.categoryId) ?? 0) + c.taxable + (claimTax ? 0 : c.vat)));
  const lines: PostLineInput[] = [...byCategory].map(([accountId, amount]) => ({ accountId, debitAmount: amount, description: `Bill ${billNumber}` }));
  if (claimTax) lines.push({ accountId: taxReceivableId, debitAmount: tax, description: `Tax on bill ${billNumber}` });
  for (const payment of paymentList.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: payment.accountId, creditAmount: round2(payment.amount), description: `Bill ${billNumber}` });
  }
  return lines;
}

async function taxReceivableIdIfClaimed(tenantId: string, tax: number) {
  if (tax <= 0 || !(await inputVatClaimable(tenantId))) return null;
  const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
  if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
  return taxReceivable.id;
}

function billLineItems(computed: { line: CashPurchaseLine }[]): PurchaseLineItem[] {
  return computed.map(({ line }) => ({ itemId: null, categoryId: line.categoryId, description: line.description.trim(), rate: line.rate, quantity: line.quantity, discount: line.discount }));
}

// One consumable bill per Save.
export async function createCashPurchase(input: CashPurchaseInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  if (!input.billDate) throw new Error("Bill date is required");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const prepared = await prepareCashPurchase(session.tenantId, input, parseFloat(tenant?.vatRate ?? "0") || 0);
  const vendorId = input.vendorId || null;

  // Bills without a supplier number get AUTO-n, skipping any already used.
  let billNumber = input.billNumber.trim();
  if (billNumber) {
    await assertBillNumberFree(session.tenantId, vendorId, billNumber);
  } else {
    const existing = await db.select({ n: purchaseBills.billNumber }).from(purchaseBills).where(eq(purchaseBills.tenantId, session.tenantId));
    const taken = new Set(existing.map((r) => r.n));
    billNumber = nextFreeInvoiceNumber(taken, (n) => `AUTO-${n}`, taken.size + 1).number;
  }
  await assertPeriodOpen(session.tenantId, input.billDate);
  const taxReceivableId = await taxReceivableIdIfClaimed(session.tenantId, prepared.tax);

  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId: session.tenantId,
      vendorId,
      billNumber,
      billDate: input.billDate,
      billType: input.billType,
      description: prepared.description,
      lineItems: billLineItems(prepared.computed),
      subtotal: prepared.subtotal.toFixed(2),
      taxAmount: prepared.tax.toFixed(2),
      total: prepared.total.toFixed(2),
      purchaseType: "cash",
      status: "paid",
      amountPaid: prepared.total.toFixed(2),
      billAvailable: input.billAvailable ?? null,
    })
    .returning();

  try {
    const entry = await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.billDate,
      sourceType: "purchase",
      sourceId: bill.id,
      referenceNumber: billNumber,
      memo: `Consumable purchase ${billNumber}`,
      createdBy: session.userId,
      lines: cashPurchaseEntryLines(prepared.computed, prepared.tax, taxReceivableId, billNumber, input.payments),
    });
    await insertEmbeddedSupplierPayment(session.tenantId, session.userId, vendorId, bill.id, input.billDate, prepared.total, input.payments[0].accountId, entry.id, billNumber);
  } catch (e) {
    await discardBill(session.tenantId, bill.id, session.userId);
    throw e;
  }

  revalidatePath("/purchases/consumable");
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
  if (existing.status === "void") throw new Error("Cannot edit a void bill");
  if (!input.billDate) throw new Error("Bill date is required");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const prepared = await prepareCashPurchase(session.tenantId, input, parseFloat(tenant?.vatRate ?? "0") || 0);
  const vendorId = input.vendorId || null;
  const billNumber = input.billNumber.trim() || existing.billNumber;

  // Everything is checked before the old entry is reversed, so a refusal leaves the bill untouched.
  await assertNoLaterPayments(session.tenantId, "purchase_bill", input.billId, "bill");
  await assertBillNumberFree(session.tenantId, vendorId, billNumber, input.billId);
  await assertPeriodOpen(session.tenantId, input.billDate);
  await assertPeriodOpen(session.tenantId, todayIso());
  const taxReceivableId = await taxReceivableIdIfClaimed(session.tenantId, prepared.tax);

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
      amountPaid: prepared.total.toFixed(2),
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
    lines: cashPurchaseEntryLines(prepared.computed, prepared.tax, taxReceivableId, billNumber, input.payments),
  });
  await insertEmbeddedSupplierPayment(session.tenantId, session.userId, vendorId, input.billId, input.billDate, prepared.total, input.payments[0].accountId, entry.id, billNumber);

  revalidatePath("/purchases/consumable");
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
  const payments = entryLines.filter((l) => Number(l.creditAmount) > 0).map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount) }));

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
  if (!can(session, "purchases", "delete")) throw new Error("Not permitted");

  const billId = String(formData.get("billId"));

  const [bill] = await db
    .select()
    .from(purchaseBills)
    .where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, session.tenantId)))
    .limit(1);
  if (!bill) throw new Error("Bill not found");
  if (bill.status === "void") throw new Error("Bill is already void");

  await assertNoLaterPayments(session.tenantId, "purchase_bill", billId, "bill");
  await assertStockCovers(session.tenantId, bill.lineItems ?? []);

  await reverseActiveEntry(session.tenantId, billId, session.userId, `Void of bill ${bill.billNumber}`);
  await deleteEmbeddedPaymentsForBill(session.tenantId, billId);
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
  vendorId: string,
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
    const apId = await getOrCreateSupplierPayableAccountId(tenantId, vendorId);
    lines.push({ accountId: apId, creditAmount: remaining, description: `Invoice ${invoiceLabel}` });
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

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (!input.vendorId) throw new Error("Select a supplier");
  if (!input.invoiceDate) throw new Error("Invoice date is required");
  if (input.dueDate && input.dueDate < input.invoiceDate) throw new Error("The due date can't be before the invoice date");

  const { validLines, subtotal, taxAmount, total } = await computeInvoiceTotals(session.tenantId, input.lines, input.billType);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const remaining = round2(Math.max(total - paid, 0));
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";

  // Everything is checked before anything is saved.
  await assertSupplierOwned(session.tenantId, input.vendorId);
  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertBillNumberFree(session.tenantId, input.vendorId, invoiceNumber);
  await assertPeriodOpen(session.tenantId, input.invoiceDate);

  const journalLines = await buildInvoiceJournalLines(
    session.tenantId,
    input.vendorId,
    invoiceNumber,
    subtotal,
    taxAmount,
    remaining,
    input.payments,
    await inputVatClaimable(session.tenantId)
  );

  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId: session.tenantId,
      vendorId: input.vendorId,
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
    await applyStockDelta(session.tenantId, validLines, 1);
    stockApplied = true;

    if (paid > 0) {
      const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
      await insertEmbeddedSupplierPayment(session.tenantId, session.userId, input.vendorId, bill.id, input.invoiceDate, paid, paymentLines[0].accountId, entry.id, invoiceNumber);
    }
  } catch (e) {
    if (stockApplied) await applyStockDelta(session.tenantId, validLines, -1).catch(() => {});
    await discardBill(session.tenantId, bill.id, session.userId);
    throw e;
  }

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
    .map((l) => ({ accountId: l.accountId, amount: Number(l.creditAmount) }));

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

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (!input.vendorId) throw new Error("Select a supplier");
  if (!input.invoiceDate) throw new Error("Invoice date is required");
  if (input.dueDate && input.dueDate < input.invoiceDate) throw new Error("The due date can't be before the invoice date");

  const { validLines, subtotal, taxAmount, total } = await computeInvoiceTotals(session.tenantId, input.lines, input.billType);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error("Recorded payment exceeds the invoice total");
  const remaining = round2(Math.max(total - paid, 0));
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";

  // Everything is checked before the old entry is reversed, so a refusal leaves the invoice untouched.
  await assertNoLaterPayments(session.tenantId, "purchase_bill", input.billId, "bill");
  await assertSupplierOwned(session.tenantId, input.vendorId);
  await assertCashBankAccounts(session.tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertBillNumberFree(session.tenantId, input.vendorId, invoiceNumber, input.billId);
  await assertPeriodOpen(session.tenantId, input.invoiceDate);
  await assertPeriodOpen(session.tenantId, todayIso());
  // Shrinking the purchase takes stock out: only what is still on hand can go.
  const shrink = new Map<string, number>();
  for (const l of existing.lineItems ?? []) if (l.itemId) shrink.set(l.itemId, (shrink.get(l.itemId) ?? 0) + l.quantity);
  for (const l of validLines) if (l.itemId) shrink.set(l.itemId, (shrink.get(l.itemId) ?? 0) - l.quantity);
  await assertStockCovers(session.tenantId, [...shrink].map(([itemId, quantity]) => ({ itemId, quantity })));

  const journalLines = await buildInvoiceJournalLines(
    session.tenantId,
    input.vendorId,
    invoiceNumber,
    subtotal,
    taxAmount,
    remaining,
    input.payments,
    await inputVatClaimable(session.tenantId)
  );

  await reverseActiveEntry(session.tenantId, input.billId, session.userId, `Edit of invoice ${existing.billNumber}`);
  await deleteEmbeddedPaymentsForBill(session.tenantId, input.billId);
  await applyStockDelta(session.tenantId, existing.lineItems ?? [], -1);
  await applyStockDelta(session.tenantId, validLines, 1);

  await db
    .update(purchaseBills)
    .set({
      vendorId: input.vendorId,
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
    await insertEmbeddedSupplierPayment(session.tenantId, session.userId, input.vendorId, input.billId, input.invoiceDate, paid, paymentLines[0].accountId, entry.id, invoiceNumber);
  }

  revalidatePath("/purchases/stockable");
  revalidatePath("/suppliers");
  revalidatePath("/dashboard");
  revalidatePath("/inventory/items");
  revalidatePath("/journal");
}
