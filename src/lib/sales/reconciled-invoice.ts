import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalLines, paymentAllocations, payments, salesInvoices, type LineItem } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { getOrCreateCustomerReceivableAccountId } from "@/lib/ledger/subledger-accounts";
import { resettleParty } from "@/lib/ledger/party-settlement";
import { reverseJournalEntry } from "@/lib/ledger/post";
import { activeEntriesOfSource, isSourceReconciled, linesFromNet, postReclass } from "@/lib/ledger/reclass";
import { assertRevenueAccount, resolveRevenueLines } from "./revenue-accounts";
import { ensureCashCustomer, takenInvoiceNumbers } from "./invoice-records";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReconciledInvoiceEdit = {
  invoiceId: string;
  /** Blank only for a sale paid in full (a cash sale). */
  customerId: string;
  invoiceNumber: string;
  dueDate: string | null;
  /** The revenue account for the whole invoice; blank: each item's own account, else Sales Revenue. */
  revenueAccountId: string | null;
  /** Why the customer or revenue account is being changed: required then, recorded with the change. */
  reason?: string;
};

/**
 * Editing a sales invoice whose entries have been reconciled (its payment matched to a bank statement or ticked in a cash reconciliation). The date, items,
 * VAT, totals and payments are what was reconciled and cannot change. The customer, revenue account, invoice number and due date can. Moving the customer
 * (their whole invoice and what was paid on it moves from one account to the other) or the revenue account is posted as a small voucher, with the reason.
 */
export async function changeReconciledSalesInvoice(tenantId: string, userId: string, input: ReconciledInvoiceEdit): Promise<{ changed: boolean }> {
  const [existing] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, input.invoiceId), eq(salesInvoices.tenantId, tenantId))).limit(1);
  if (!existing) throw new Error("Invoice not found");
  if (existing.status === "void") throw new Error("Cannot edit a void invoice");
  if (!(await isSourceReconciled(tenantId, existing.id))) throw new Error("This invoice has not been reconciled, so it can be edited in full.");

  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new Error("Invoice number is required");
  if (invoiceNumber !== existing.invoiceNumber && (await takenInvoiceNumbers(tenantId, existing.id)).has(invoiceNumber)) throw new Error(`Invoice number ${invoiceNumber} is already used`);
  const dueDate = input.dueDate || null;
  if (dueDate && dueDate < existing.invoiceDate) throw new Error("The due date can't be before the invoice date");

  const total = Number(existing.total);
  const paid = Number(existing.amountPaid);
  // With no customer the sale goes to the Cash Sale stand-in, and only when it was paid in full.
  let customerId = input.customerId;
  if (!customerId) {
    if (!(total > 0 && paid >= total - 0.004)) throw new Error("Choose a customer: this invoice is not paid in full, so someone owes the rest.");
    customerId = await ensureCashCustomer(tenantId);
  }
  const customerChanged = customerId !== existing.customerId;

  const revenueAccountId = input.revenueAccountId ? await assertRevenueAccount(tenantId, input.revenueAccountId) : null;

  // The revenue accounts the invoice credits now (its own entry, and anything moved since), and where they would be with the new choice.
  const active = await activeEntriesOfSource(tenantId, existing.id);
  const lines = active.length > 0 ? await db.select().from(journalLines).where(inArray(journalLines.journalEntryId, active.map((e) => e.id))) : [];
  const incomeIds = new Set(
    (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.category, "income")))).map((a) => a.id)
  );
  const now = new Map<string, number>();
  for (const l of lines) {
    if (!incomeIds.has(l.accountId)) continue;
    now.set(l.accountId, round2((now.get(l.accountId) ?? 0) + Number(l.creditAmount) - Number(l.debitAmount)));
  }
  const revenueTotal = round2([...now.values()].reduce((s, v) => s + v, 0));
  const stored = (existing.lineItems ?? []) as LineItem[];
  const want = new Map<string, number>();
  if (revenueAccountId) want.set(revenueAccountId, revenueTotal);
  else if (stored.length > 0) {
    const resolved = await resolveRevenueLines(tenantId, stored.map((l) => ({ itemId: l.itemId ?? null, amount: round2(Math.max(round2(l.quantity * l.unitPrice) - (l.discount ?? 0), 0)) })));
    for (const r of resolved) want.set(r.accountId, round2((want.get(r.accountId) ?? 0) + r.amount));
  } else {
    // An invoice made in a batch has no item lines: it keeps the account it has, unless one is chosen.
    for (const [id, v] of now) want.set(id, v);
  }
  const net = new Map<string, number>(); // debit minus credit
  const accountsTouched = new Set([...now.keys(), ...want.keys()]);
  for (const id of accountsTouched) {
    const delta = round2((want.get(id) ?? 0) - (now.get(id) ?? 0)); // more credit wanted
    if (delta !== 0) net.set(id, round2((net.get(id) ?? 0) - delta));
  }
  const revenueMoves = net.size > 0;

  // Moving the customer: the invoice and what was paid on it leave one account and enter the other.
  let arOld: string | null = null;
  let arNew: string | null = null;
  if (customerChanged) {
    [arOld, arNew] = await Promise.all([getOrCreateCustomerReceivableAccountId(tenantId, existing.customerId), getOrCreateCustomerReceivableAccountId(tenantId, customerId)]);
    net.set(arNew, round2((net.get(arNew) ?? 0) + total - paid));
    net.set(arOld, round2((net.get(arOld) ?? 0) - (total - paid)));
  }

  const detailsChanged = invoiceNumber !== existing.invoiceNumber || dueDate !== (existing.dueDate ?? null);
  if (!customerChanged && !revenueMoves && !detailsChanged) return { changed: false };

  const reason = (input.reason ?? "").trim();
  if ((customerChanged || revenueMoves) && !reason) throw new Error("Say why this is being changed: an invoice that has been reconciled can still move to another customer or revenue account, and the reason is recorded with it.");

  let voucherId: string | null = null;
  const voucherLines = customerChanged
    ? // the customer's side is kept in two parts (what was invoiced, what was paid) so each account's history still reads as it happened
      [
        ...linesFromNet(new Map([...net].filter(([id]) => id !== arNew && id !== arOld)), reason),
        { accountId: arNew!, debitAmount: total, description: reason },
        { accountId: arOld!, creditAmount: total, description: reason },
        ...(paid > 0 ? [{ accountId: arOld!, debitAmount: paid, description: reason }, { accountId: arNew!, creditAmount: paid, description: reason }] : []),
      ]
    : linesFromNet(net, reason);
  if (voucherLines.length > 0) {
    voucherId = await postReclass({
      tenantId,
      userId,
      sourceId: existing.id,
      referenceNumber: invoiceNumber,
      memo: `Invoice ${existing.invoiceNumber} — changed after reconciliation: ${reason}`,
      anchorDate: existing.invoiceDate,
      lines: voucherLines,
    });
  }

  try {
    await db
      .update(salesInvoices)
      .set({ customerId, invoiceNumber, dueDate, revenueAccountId })
      .where(and(eq(salesInvoices.id, existing.id), eq(salesInvoices.tenantId, tenantId)));
    if (customerChanged) {
      // The payments taken with the invoice follow it to the new customer.
      const embedded = await db
        .select({ id: payments.id })
        .from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "embedded"), eq(paymentAllocations.targetType, "sales_invoice"), eq(paymentAllocations.targetId, existing.id)));
      if (embedded.length > 0) await db.update(payments).set({ customerId }).where(and(eq(payments.tenantId, tenantId), inArray(payments.id, embedded.map((p) => p.id))));
    }
  } catch (e) {
    if (voucherId) {
      await reverseJournalEntry(tenantId, voucherId, userId, `Change to invoice ${existing.invoiceNumber} could not be completed`).catch(() => {});
    }
    throw e;
  }
  if (customerChanged) {
    await resettleParty(tenantId, "customer", existing.customerId).catch(() => {});
    await resettleParty(tenantId, "customer", customerId).catch(() => {});
  }

  await logAuditEvent({
    tenantId,
    userId,
    action: "sales_invoice_changed_after_reconciliation",
    entityType: "sales_invoice",
    entityId: existing.id,
    before: { invoice: existing.invoiceNumber, customer: existing.customerId, revenueAccount: existing.revenueAccountId ?? "—", dueDate: existing.dueDate ?? "—" },
    after: { invoice: invoiceNumber, customer: customerId, revenueAccount: revenueAccountId ?? "—", dueDate: dueDate ?? "—", ...(reason ? { reason } : {}) },
  });
  return { changed: true };
}
