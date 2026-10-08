import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, customers, payments, paymentAllocations, salesInvoices, tenants } from "@/db/schema";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateCustomerReceivableAccountId } from "@/lib/ledger/subledger-accounts";
import { buildInvoiceNumber } from "@/lib/invoice-number";
import { withPaymentNumber } from "@/lib/payment-number";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { autoApplyAdvance } from "@/lib/ledger/advance-applications";
import { salesVatRate } from "@/lib/sales/vat";
import { assertRevenueAccount } from "@/lib/sales/revenue-accounts";
import { resolvePaymentMode } from "@/lib/payment-modes";
import { assertCashBankAccounts } from "@/lib/ledger/account-guards";

// The records every way of creating a sales invoice shares (the Single and Multi-Invoice forms, and Import Sales): the
// invoice-number rules, the embedded payment row, the clean-up of an invoice that failed to save, and the batch writer
// itself. Kept out of the "use server" action file so these are plain helpers, not callable endpoints.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesBillType = "taxable" | "zero_rated";
export type BatchPaymentLine = { accountId: string; amount: number; /** The payment mode picked, if any. */ modeId?: string | null };
export type BatchInvoiceRow = {
  invoiceDate: string;
  customerId: string;
  grossAmount: number;
  discountAmount: number;
  billType?: SalesBillType;
  /** The revenue account to book to; blank uses the default Sales Revenue account. */
  revenueAccountId?: string | null;
  payments: BatchPaymentLine[];
};

// Every invoice number in use in this organization (void ones too — a number is never reused).
export async function takenInvoiceNumbers(tenantId: string, excludeInvoiceId?: string) {
  const rows = await db.select({ id: salesInvoices.id, n: salesInvoices.invoiceNumber }).from(salesInvoices).where(eq(salesInvoices.tenantId, tenantId));
  return new Set(rows.filter((r) => r.id !== excludeInvoiceId).map((r) => r.n));
}

// Deletes the embedded (paid-at-creation) Payment-module row(s) recorded
// for this invoice, cascading to their allocation rows — used before a void
// or edit re-posts fresh entries, mirroring how the old receipts table was
// cleared in the same spots.
export async function deleteEmbeddedPaymentsForInvoice(tenantId: string, invoiceId: string) {
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

// A failed save must not leave half an invoice behind: undo whatever posted and drop the row.
export async function discardInvoice(tenantId: string, invoiceId: string, userId: string) {
  await reverseAllActiveEntriesForSource(tenantId, invoiceId, userId, "Rolled back — invoice could not be saved").catch(() => {});
  await deleteEmbeddedPaymentsForInvoice(tenantId, invoiceId).catch(() => {});
  await db.delete(salesInvoices).where(eq(salesInvoices.id, invoiceId));
}

// Records the embedded customer-payment row (+ its allocation to this
// invoice) in the unified Payment module for a payment captured at invoice
// creation/edit time — the accounting entry itself is posted separately by
// the caller, unchanged; this is purely the Payment module's own record of
// that same fact so it shows up in the Payments list and reconciliation.
export async function insertEmbeddedCustomerPayment(
  tenantId: string,
  userId: string,
  customerId: string,
  invoiceId: string,
  paymentDate: string,
  amount: number,
  accountId: string,
  journalEntryId: string,
  referenceNumber: string,
  modeId?: string | null
) {
  const mode = await resolvePaymentMode(tenantId, modeId, accountId);
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
        paymentMethod: mode.paymentMethod,
        paymentModeId: mode.paymentModeId,
        paymentModeName: mode.paymentModeName,
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

// Used when a row is settled in full with no customer chosen — a customer is
// only required when the payment doesn't cover the invoice total, since the
// shortfall has to be tracked as that customer's outstanding balance.
export async function ensureCashCustomer(tenantId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.name, "Cash Sale")))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(customers).values({ tenantId, name: "Cash Sale", openingBalance: "0" }).returning();
  return created.id;
}

export async function ensureBankAccount(tenantId: string, chartAccountId: string): Promise<string> {
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

export type CreatedInvoice = { index: number; invoiceId: string; invoiceNumber: string };

/** A batch that stopped part-way: the invoices posted before the failing row are still real, and are reported here. */
export class PartialBatchError extends Error {
  constructor(message: string, public created: CreatedInvoice[], public failedIndex: number) {
    super(message);
    this.name = "PartialBatchError";
  }
}

/**
 * Writes a batch of one-row-per-invoice sales: each gets the next invoice number, its sale entry (and receipt entry when
 * paid), an embedded payment record, and any advance the customer already paid is applied. Rows are checked first
 * (dates in closed periods, accounts, customers needed for part-paid rows) so a bad batch is refused before anything is
 * saved. The index in each result is the row's position in `rows`.
 */
export async function postSalesBatch(ctx: { tenantId: string; userId: string }, rows: BatchInvoiceRow[], opts: { importId?: string } = {}): Promise<CreatedInvoice[]> {
  const { tenantId, userId } = ctx;
  const indexed = rows.map((r, index) => ({ r, index })).filter(({ r }) => r.invoiceDate && r.grossAmount > 0);
  if (indexed.length === 0) throw new Error("Add at least one invoice row");

  for (let i = 0; i < indexed.length; i++) {
    const r = indexed[i].r;
    if (r.discountAmount < 0 || r.discountAmount > r.grossAmount) {
      throw new Error(`Row ${i + 1}: discount must be between 0 and the gross amount`);
    }
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  // Refuse up front if any invoice date sits in a locked period, before anything is saved.
  for (const date of new Set(indexed.map(({ r }) => r.invoiceDate))) await assertPeriodOpen(tenantId, date);
  await assertCashBankAccounts(tenantId, indexed.flatMap(({ r }) => r.payments.filter((p) => p.amount > 0).map((p) => p.accountId)));

  const chosen = new Set(indexed.map(({ r }) => r.revenueAccountId).filter((id): id is string => Boolean(id)));
  for (const id of chosen) await assertRevenueAccount(tenantId, id);
  const needsDefault = indexed.some(({ r }) => !r.revenueAccountId);
  const defaultRevenue = needsDefault ? await findControlAccount(tenantId, ["4000"], "Sales Revenue") : null;
  if (needsDefault && !defaultRevenue) throw new Error("No Sales Revenue account found — add one to the Chart of Accounts first");

  // A row is taxed at the rate that applied on ITS OWN date — rows in one batch can span a rate change.
  const vatRateByDate = new Map<string, number>();
  for (const date of new Set(indexed.map(({ r }) => r.invoiceDate))) vatRateByDate.set(date, await salesVatRate(tenantId, date));

  const computedRows = indexed.map(({ r, index }) => {
    const billType: SalesBillType = r.billType ?? "taxable";
    const subtotal = round2(r.grossAmount - r.discountAmount);
    // Zero-rated bills never carry VAT, regardless of the rate that applied on the row's own date.
    const vatRate = billType === "taxable" ? vatRateByDate.get(r.invoiceDate)! : 0;
    const taxAmount = round2(subtotal * (vatRate / 100));
    const total = round2(subtotal + taxAmount);
    const paid = round2(r.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
    return { ...r, index, billType, subtotal, taxAmount, total, paid };
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
    const taxPayable = await findControlAccount(tenantId, ["2100"], "Tax Payable");
    if (!taxPayable) throw new Error("No Tax Payable account found — add one to the Chart of Accounts first");
    taxPayableId = taxPayable.id;
  }

  const cashCustomerId = computedRows.some((r) => !r.customerId) ? await ensureCashCustomer(tenantId) : null;

  const taken = await takenInvoiceNumbers(tenantId);
  let nextSequence = taken.size + 1;

  const arCache = new Map<string, string>();
  async function resolveAr(customerId: string) {
    const cached = arCache.get(customerId);
    if (cached) return cached;
    const id = await getOrCreateCustomerReceivableAccountId(tenantId, customerId);
    arCache.set(customerId, id);
    return id;
  }

  const created: CreatedInvoice[] = [];
  for (const row of computedRows) {
    try {
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
          tenantId,
          customerId,
          invoiceNumber,
          invoiceDate: row.invoiceDate,
          grossAmount: row.grossAmount.toFixed(2),
          discountAmount: row.discountAmount.toFixed(2),
          subtotal: subtotal.toFixed(2),
          taxTreatment: row.billType,
          taxAmount: taxAmount.toFixed(2),
          total: total.toFixed(2),
          amountPaid: paid.toFixed(2),
          status,
          importId: opts.importId ?? null,
          revenueAccountId: row.revenueAccountId || null,
        })
        .returning();

      try {
        const lines: PostLineInput[] = [
          { accountId: arId, debitAmount: total, description: `Invoice ${invoiceNumber}` },
          { accountId: row.revenueAccountId || defaultRevenue!.id, creditAmount: subtotal, description: `Invoice ${invoiceNumber}` },
        ];
        if (taxAmount > 0 && taxPayableId) {
          lines.push({ accountId: taxPayableId, creditAmount: taxAmount, description: `Tax on invoice ${invoiceNumber}` });
        }

        await postJournalEntry({
          tenantId,
          entryDate: row.invoiceDate,
          sourceType: "sale",
          sourceId: invoice.id,
          referenceNumber: invoiceNumber,
          memo: `Sales invoice ${invoiceNumber}`,
          createdBy: userId,
          lines,
        });

        if (paid > 0) {
          const paymentLines = row.payments.filter((p) => p.accountId && p.amount > 0);
          const receiptLines: PostLineInput[] = paymentLines.map((p) => ({
            accountId: p.accountId,
            paymentModeId: p.modeId,
            debitAmount: p.amount,
            description: `Payment received for ${invoiceNumber}`,
          }));
          receiptLines.push({ accountId: arId, creditAmount: paid, description: `Payment received for ${invoiceNumber}` });

          const receiptEntry = await postJournalEntry({
            tenantId,
            entryDate: row.invoiceDate,
            sourceType: "receipt",
            sourceId: invoice.id,
            referenceNumber: invoiceNumber,
            memo: `Payment received for ${invoiceNumber}`,
            createdBy: userId,
            lines: receiptLines,
          });

          await ensureBankAccount(tenantId, paymentLines[0].accountId);
          await insertEmbeddedCustomerPayment(tenantId, userId, customerId, invoice.id, row.invoiceDate, paid, paymentLines[0].accountId, receiptEntry.id, invoiceNumber, paymentLines[0].modeId);
        }
      } catch (e) {
        await discardInvoice(tenantId, invoice.id, userId);
        throw e;
      }
      created.push({ index: row.index, invoiceId: invoice.id, invoiceNumber });
    } catch (e) {
      if (created.length === 0) throw e;
      throw new PartialBatchError(e instanceof Error ? e.message : "A row could not be saved", created, row.index);
    }
  }

  // Any advance these customers have paid goes to their oldest open invoices first.
  for (const id of new Set(computedRows.map((r) => r.customerId).filter(Boolean))) {
    await autoApplyAdvance(tenantId, userId, "customer", id);
  }
  return created;
}
