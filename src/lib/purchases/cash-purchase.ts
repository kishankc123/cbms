import { eq } from "drizzle-orm";
import { db } from "@/db";
import { purchaseBills, type PurchaseLineItem } from "@/db/schema";
import { postJournalEntry, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { assertCashBankAccounts, assertCogsCategory, assertSupplierOwned } from "@/lib/ledger/account-guards";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { autoApplyAdvance } from "@/lib/ledger/advance-applications";
import { assertBillNumberFree, discardBill, insertEmbeddedSupplierPayment } from "@/lib/purchases/bill-records";

// A Consumable purchase: one bill with one or more lines, booked to purchase categories. The rules and the writer live
// here so the Add New form, the edit form and Import Purchases all post the same way. Kept out of the "use server" action
// file so these are plain helpers, not callable endpoints.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CashBillType = "vat" | "pan" | "estimate" | "challan" | "no_bill";

export type CashPaymentLine = { accountId: string; amount: number; modeId?: string | null };

// One line of a Consumable purchase: what was bought, and the purchase category it is booked to.
export type CashPurchaseLine = { description: string; categoryId: string; rate: number; quantity: number; discount: number };

// A Consumable purchase is ONE bill with one or more lines. It is settled by whatever payments are recorded with
// it — in full, in part or not at all; what isn't paid is owed to the supplier (Accounts Payable), so a supplier
// is required whenever the payments don't cover the total.
export type CashPurchaseInput = {
  billNumber: string;
  billDate: string;
  vendorId: string;
  billType: CashBillType;
  billAvailable?: boolean;
  lines: CashPurchaseLine[];
  payments: CashPaymentLine[];
};

export function computeCashLine(line: CashPurchaseLine, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  return { gross, discount, taxable, vat };
}

// Checks everything about a consumable purchase before anything is saved or reversed, and works out the amounts.
// VAT applies only when the bill type is VAT; the payments may not exceed the bill total (VAT included). Taxed at
// the rate that applied on the BILL'S date, not today's — a backdated bill is not re-taxed at the current rate.
export async function prepareCashPurchase(tenantId: string, input: CashPurchaseInput) {
  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one line with a rate and quantity");
  for (const categoryId of new Set(validLines.map((l) => l.categoryId))) await assertCogsCategory(tenantId, categoryId);

  const vatRate = input.billType === "vat" ? await getTaxRate(tenantId, "vat", input.billDate) : 0;
  const computed = validLines.map((l) => ({ line: l, ...computeCashLine(l, vatRate) }));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const tax = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + tax);

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) throw new Error(`The payments (${paid.toFixed(2)}) cannot exceed the bill total (${total.toFixed(2)}, VAT included)`);
  const remaining = round2(Math.max(total - paid, 0));
  if (remaining > 0.004 && !input.vendorId) throw new Error("Select a supplier — the unpaid balance is owed to them");
  await assertCashBankAccounts(tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  if (input.vendorId) await assertSupplierOwned(tenantId, input.vendorId);

  const status = (total > 0 && remaining <= 0.004 ? "paid" : paid > 0 ? "partially_paid" : "open") as "paid" | "partially_paid" | "open";
  const description = validLines.map((l) => l.description.trim()).filter(Boolean).join(", ").slice(0, 200) || null;
  return { computed, subtotal, tax, total, paid, remaining, status, description };
}

// The ledger side of a consumable purchase: each category is debited its lines' taxable amount; the VAT is
// claimed (Tax Receivable) when the organization can claim it, otherwise it is part of the cost and goes to the
// categories with the lines it belongs to. The payments are credited, and anything unpaid is credited to the
// supplier's payable account.
export function cashPurchaseEntryLines(
  computed: { line: CashPurchaseLine; taxable: number; vat: number }[],
  tax: number,
  taxReceivableId: string | null,
  billNumber: string,
  paymentList: CashPaymentLine[],
  payable: { accountId: string; amount: number } | null
): PostLineInput[] {
  const claimTax = tax > 0 && taxReceivableId;
  const byCategory = new Map<string, number>();
  for (const c of computed) byCategory.set(c.line.categoryId, round2((byCategory.get(c.line.categoryId) ?? 0) + c.taxable + (claimTax ? 0 : c.vat)));
  const lines: PostLineInput[] = [...byCategory].map(([accountId, amount]) => ({ accountId, debitAmount: amount, description: `Bill ${billNumber}` }));
  if (claimTax) lines.push({ accountId: taxReceivableId, debitAmount: tax, description: `Tax on bill ${billNumber}` });
  if (payable && payable.amount > 0) lines.push({ accountId: payable.accountId, creditAmount: payable.amount, description: `Bill ${billNumber}` });
  for (const payment of paymentList.filter((p) => p.accountId && p.amount > 0)) {
    lines.push({ accountId: payment.accountId, paymentModeId: payment.modeId, creditAmount: round2(payment.amount), description: `Bill ${billNumber}` });
  }
  return lines;
}

export async function taxReceivableIdIfClaimed(tenantId: string, tax: number) {
  if (tax <= 0 || !(await inputVatClaimable(tenantId))) return null;
  const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
  if (!taxReceivable) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
  return taxReceivable.id;
}

export function billLineItems(computed: { line: CashPurchaseLine }[]): PurchaseLineItem[] {
  return computed.map(({ line }) => ({ itemId: null, categoryId: line.categoryId, description: line.description.trim(), rate: line.rate, quantity: line.quantity, discount: line.discount }));
}

/**
 * Writes one consumable bill: its number (the supplier's own, or AUTO-n), the bill, its ledger entry, the embedded payment
 * record, and any advance already paid to the supplier. Everything is checked first, and a failure part-way leaves nothing
 * behind. `takenNumbers` lets a batch share one list of used numbers instead of reading them again for every bill.
 */
export async function createCashPurchaseCore(
  ctx: { tenantId: string; userId: string },
  input: CashPurchaseInput,
  opts: { importId?: string; takenNumbers?: Set<string> } = {}
): Promise<{ billId: string; billNumber: string }> {
  const { tenantId, userId } = ctx;
  if (!input.billDate) throw new Error("Bill date is required");

  const prepared = await prepareCashPurchase(tenantId, input);
  const vendorId = input.vendorId || null;

  // Bills without a supplier number get AUTO-n, skipping any already used.
  let billNumber = input.billNumber.trim();
  if (billNumber) {
    await assertBillNumberFree(tenantId, vendorId, billNumber);
  } else {
    const taken = opts.takenNumbers ?? new Set((await db.select({ n: purchaseBills.billNumber }).from(purchaseBills).where(eq(purchaseBills.tenantId, tenantId))).map((r) => r.n));
    billNumber = nextFreeInvoiceNumber(taken, (n) => `AUTO-${n}`, taken.size + 1).number;
    opts.takenNumbers?.add(billNumber);
  }
  await assertPeriodOpen(tenantId, input.billDate);
  const taxReceivableId = await taxReceivableIdIfClaimed(tenantId, prepared.tax);
  const payable = prepared.remaining > 0 && vendorId ? { accountId: await getOrCreateSupplierPayableAccountId(tenantId, vendorId), amount: prepared.remaining } : null;

  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId,
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
      status: prepared.status,
      amountPaid: prepared.paid.toFixed(2),
      billAvailable: input.billAvailable ?? null,
      importId: opts.importId ?? null,
    })
    .returning();

  try {
    const entry = await postJournalEntry({
      tenantId,
      entryDate: input.billDate,
      sourceType: "purchase",
      sourceId: bill.id,
      referenceNumber: billNumber,
      memo: `Consumable purchase ${billNumber}`,
      createdBy: userId,
      lines: cashPurchaseEntryLines(prepared.computed, prepared.tax, taxReceivableId, billNumber, input.payments, payable),
    });
    if (prepared.paid > 0) {
      const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
      await insertEmbeddedSupplierPayment(tenantId, userId, vendorId, bill.id, input.billDate, prepared.paid, paymentLines[0].accountId, entry.id, billNumber, paymentLines[0].modeId);
    }
  } catch (e) {
    await discardBill(tenantId, bill.id, userId);
    opts.takenNumbers?.delete(billNumber);
    throw e;
  }

  // Any advance paid to this supplier goes to their oldest open bills first.
  if (vendorId) await autoApplyAdvance(tenantId, userId, "supplier", vendorId);
  return { billId: bill.id, billNumber };
}
