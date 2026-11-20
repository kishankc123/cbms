import { db } from "@/db";
import { purchaseBills, type PurchaseLineItem } from "@/db/schema";
import { postJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { allocateProportional, assertInventoryDate, assertItemsUsable, assertTrackingOn, moveStock, unwindStock } from "@/lib/inventory/stock";
import { recalculateAfter } from "@/lib/inventory/recalc";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertSettlementAccounts, assertSupplierOwned } from "@/lib/ledger/account-guards";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { resettleParty } from "@/lib/ledger/party-settlement";
import { assertBillNumberFree, discardBill, insertEmbeddedSupplierPayment, nextAutoBillNumber } from "@/lib/purchases/bill-records";
import { invoiceRequirements } from "@/lib/purchases/invoice-requirements";
import { lineVatRate } from "@/lib/purchases/vat-lines";
import type { CashBillType } from "@/lib/purchases/cash-purchase";

// A stockable purchase invoice: one bill with item lines. The writing lives here so the single invoice form, the multi-invoice grid and the item import all
// post the same way. Plain helpers, not server actions: the actions check the permission first.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PurchaseInvoicePayment = { accountId: string; amount: number; modeId?: string | null };

export type PurchaseInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: string;
  vendorId: string;
  billType: CashBillType;
  dueDate?: string | null;
  billAvailable?: boolean;
  lines: PurchaseLineItem[];
  payments: PurchaseInvoicePayment[];
  /** Adding the items to a purchase recorded by amount: they must add up to the amount it was recorded with, unless this confirms that amount was wrong. */
  acceptDifferentTotal?: boolean;
};

function computeInvoiceLine(line: PurchaseLineItem, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  const total = round2(taxable + vat);
  return { gross, discount, taxable, vat, total };
}

// VAT only applies when the invoice is marked as a VAT bill, and then only to its taxable lines: a zero-rated or exempt line carries none. A PAN,
// Estimate, or No bill invoice books the taxable amount with no VAT line.
export async function computeInvoiceTotals(tenantId: string, lines: PurchaseLineItem[], billType: CashBillType, invoiceDate: string) {
  // Taxed at the rate that applied on the invoice's OWN date, not today's.
  const vatRate = billType === "vat" ? await getTaxRate(tenantId, "vat", invoiceDate) : 0;

  // The treatment is kept on the line only for a VAT bill, where it means something.
  const validLines = lines
    .filter((l) => l.quantity > 0 && l.rate > 0)
    .map((l): PurchaseLineItem => {
      const { taxTreatment, ...rest } = l;
      return billType === "vat" && taxTreatment && taxTreatment !== "taxable" ? { ...rest, taxTreatment } : rest;
    });
  const computed = validLines.map((l) => computeInvoiceLine(l, lineVatRate(billType, l.taxTreatment, vatRate)));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  return { validLines, computed, subtotal, taxAmount, total };
}

// Stockable purchases post to Inventory (an asset), not straight to an
// expense account — the goods are being stocked, not consumed.
export async function buildInvoiceJournalLines(
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
  const lines: PostLineInput[] = [{ accountId: inventory.id, debitAmount: claimable ? subtotal : round2(subtotal + taxAmount), description: `Invoice ${invoiceLabel}` }];

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
export function inventoryValues(computed: { taxable: number; vat: number }[], subtotal: number, taxAmount: number, claimable: boolean) {
  return allocateProportional(claimable ? subtotal : round2(subtotal + taxAmount), computed.map((c) => (claimable ? c.taxable : c.taxable + c.vat)));
}

/** Writes one stockable purchase invoice: checks everything first, then the bill, its ledger entry, the stock and any payment. A failure part-way leaves nothing behind. */
export async function createStockableInvoiceCore(ctx: { tenantId: string; userId: string }, input: PurchaseInvoiceInput): Promise<{ billNumber: string; billId: string }> {
  const { tenantId, userId } = ctx;
  await assertTrackingOn(tenantId, "Purchases with items");

  if (!input.invoiceDate) throw new Error("Invoice date is required");
  if (input.dueDate && input.dueDate < input.invoiceDate) throw new Error("The due date can't be before the invoice date");

  const { validLines, computed, subtotal, taxAmount, total } = await computeInvoiceTotals(tenantId, input.lines, input.billType, input.invoiceDate);
  if (validLines.length === 0) throw new Error("Add at least one item line");
  await assertItemsUsable(tenantId, validLines, { requireItem: true });
  await assertInventoryDate(tenantId, input.invoiceDate, validLines);

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
  if (!invoiceNumber) invoiceNumber = await nextAutoBillNumber(tenantId);

  // Everything is checked before anything is saved.
  if (vendorId) await assertSupplierOwned(tenantId, vendorId);
  await assertSettlementAccounts(tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertBillNumberFree(tenantId, vendorId, invoiceNumber);
  await assertPeriodOpen(tenantId, input.invoiceDate);

  const claimable = await inputVatClaimable(tenantId);
  const stockValues = inventoryValues(computed, subtotal, taxAmount, claimable);
  const journalLines = await buildInvoiceJournalLines(tenantId, vendorId, invoiceNumber, subtotal, taxAmount, remaining, input.payments, claimable);

  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId,
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
      tenantId,
      entryDate: input.invoiceDate,
      sourceType: "purchase",
      sourceId: bill.id,
      referenceNumber: invoiceNumber,
      memo: `Stockable purchase ${invoiceNumber}`,
      createdBy: userId,
      lines: journalLines,
    });
    await moveStock(
      tenantId,
      { type: "purchase", date: input.invoiceDate, sourceType: "purchase", sourceId: bill.id, userId },
      validLines.map((l, i) => ({ itemId: l.itemId, quantity: l.quantity, value: stockValues[i] }))
    );
    stockApplied = true;

    if (paid > 0) {
      const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
      await insertEmbeddedSupplierPayment(tenantId, userId, vendorId, bill.id, input.invoiceDate, paid, paymentLines[0].accountId, entry.id, invoiceNumber, paymentLines[0].modeId);
    }
  } catch (e) {
    if (stockApplied) await unwindStock(tenantId, { date: input.invoiceDate, sourceType: "purchase", sourceId: bill.id, userId }, { allowNegative: true }).catch(() => {});
    await discardBill(tenantId, bill.id, userId);
    throw e;
  }

  // Money paid to the supplier ahead settles their oldest bills first (it is on their ledger).
  await resettleParty(tenantId, "supplier", vendorId);
  await recalculateAfter(tenantId, validLines.map((l) => l.itemId), userId, `Purchase ${invoiceNumber}`);
  return { billNumber: invoiceNumber, billId: bill.id };
}
