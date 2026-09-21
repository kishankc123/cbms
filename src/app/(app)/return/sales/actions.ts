"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { salesReturns, customers, type LineItem } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { ensureSalesReturnsAccount } from "@/lib/ledger/return-accounts";
import { getOrCreateCustomerReceivableAccountId } from "@/lib/ledger/subledger-accounts";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getCreditInfo, applyCredit, unapplyCredit, assertNoAppliedCredit } from "@/lib/ledger/credit-applications";
import { salesVatRate } from "@/lib/sales/vat";
import { applyStockDelta, computeCogsTotal } from "@/lib/inventory/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesReturnLine = { itemId: string | null; description: string; rate: number; quantity: number; discount: number };
export type SalesReturnInput = { noteNumber: string; noteDate: string; customerId: string; lines: SalesReturnLine[] };

function computeLine(line: SalesReturnLine, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  return { gross, discount, taxable, vat };
}

function refresh() {
  for (const p of ["/return/sales", "/sales", "/chart-of-accounts", "/dashboard", "/journal", "/customers", "/inventory/items"]) revalidatePath(p);
}

/**
 * Records a sales return (debit note) for a customer. It undoes part of a sale:
 *   Dr Sales Returns (4050, contra-revenue; taxable) + Dr Tax Payable (VAT)  /  Cr the customer's receivable account
 * and, for stocked items, puts the goods back: Dr Inventory / Cr Cost of Goods Sold at cost.
 */
export async function createSalesReturn(input: SalesReturnInput) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");

  const noteNumber = input.noteNumber.trim();
  if (!noteNumber) throw new Error("Debit note number is required");
  if (!input.customerId) throw new Error("Select a customer");
  if (!input.noteDate) throw new Error("Date is required");

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, session.tenantId)))
    .limit(1);
  if (!customer) throw new Error("Customer not found");

  const [dupe] = await db
    .select({ id: salesReturns.id })
    .from(salesReturns)
    .where(and(eq(salesReturns.tenantId, session.tenantId), eq(salesReturns.noteNumber, noteNumber)))
    .limit(1);
  if (dupe) throw new Error(`Debit note number ${noteNumber} is already used`);

  await assertPeriodOpen(session.tenantId, input.noteDate);

  const vatRate = await salesVatRate(session.tenantId);

  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  const computed = validLines.map((l) => computeLine(l, vatRate));
  const grossAmount = round2(computed.reduce((s, c) => s + c.gross, 0));
  const discountAmount = round2(computed.reduce((s, c) => s + c.discount, 0));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  const arId = await getOrCreateCustomerReceivableAccountId(session.tenantId, input.customerId);
  const returnsAccount = await ensureSalesReturnsAccount(session.tenantId);
  let taxPayableId: string | null = null;
  if (taxAmount > 0) {
    const tax = await findControlAccount(session.tenantId, ["2100"], "Tax Payable");
    if (!tax) throw new Error("No Tax Payable account found — add one to the Chart of Accounts first");
    taxPayableId = tax.id;
  }
  const cost = await computeCogsTotal(session.tenantId, validLines);
  let cogsId: string | null = null;
  let inventoryId: string | null = null;
  if (cost > 0) {
    const cogs = await findControlAccount(session.tenantId, ["5000"], "Cost of Goods Sold");
    const inventory = await findControlAccount(session.tenantId, ["1200"], "Inventory");
    if (!cogs || !inventory) throw new Error("Cost of Goods Sold and Inventory accounts are needed to return stocked items");
    cogsId = cogs.id;
    inventoryId = inventory.id;
  }

  const lineItems: LineItem[] = validLines.map((l) => ({
    itemId: l.itemId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.rate,
    discount: l.discount,
    taxRate: vatRate,
  }));

  const [note] = await db
    .insert(salesReturns)
    .values({
      tenantId: session.tenantId,
      customerId: input.customerId,
      noteNumber,
      noteDate: input.noteDate,
      lineItems,
      grossAmount: grossAmount.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
    })
    .returning();

  try {
    const lines: PostLineInput[] = [
      { accountId: returnsAccount.id, debitAmount: subtotal, description: `Sales return ${noteNumber}` },
      { accountId: arId, creditAmount: total, description: `Debit note ${noteNumber}` },
    ];
    if (taxAmount > 0 && taxPayableId) lines.splice(1, 0, { accountId: taxPayableId, debitAmount: taxAmount, description: `Tax on sales return ${noteNumber}` });
    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.noteDate,
      sourceType: "sales_return",
      sourceId: note.id,
      referenceNumber: noteNumber,
      memo: `Sales return ${noteNumber}`,
      createdBy: session.userId,
      lines,
    });

    if (cost > 0 && cogsId && inventoryId) {
      await postJournalEntry({
        tenantId: session.tenantId,
        entryDate: input.noteDate,
        sourceType: "sales_return",
        sourceId: note.id,
        referenceNumber: noteNumber,
        memo: `Stock returned on ${noteNumber}`,
        createdBy: session.userId,
        lines: [
          { accountId: inventoryId, debitAmount: cost, description: `Stock returned on ${noteNumber}` },
          { accountId: cogsId, creditAmount: cost, description: `Stock returned on ${noteNumber}` },
        ],
      });
    }
  } catch (e) {
    // Nothing was booked, so don't leave the document behind without its accounting.
    await reverseAllActiveEntriesForSource(session.tenantId, note.id, session.userId, `Rolled back ${noteNumber}`).catch(() => {});
    await db.delete(salesReturns).where(eq(salesReturns.id, note.id));
    throw e;
  }

  await applyStockDelta(session.tenantId, validLines, 1);
  refresh();
}

/** Voids a debit note: reverses what it posted and takes the returned stock back out. */
export async function voidSalesReturn(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "delete")) throw new Error("Not permitted");

  const id = String(formData.get("noteId"));
  const [note] = await db
    .select()
    .from(salesReturns)
    .where(and(eq(salesReturns.id, id), eq(salesReturns.tenantId, session.tenantId)))
    .limit(1);
  if (!note) throw new Error("Debit note not found");
  if (note.status === "void") throw new Error("Debit note is already void");

  await assertNoAppliedCredit(session.tenantId, note.id, note.noteNumber);
  await reverseAllActiveEntriesForSource(session.tenantId, note.id, session.userId, `Void of debit note ${note.noteNumber}`);
  await applyStockDelta(session.tenantId, (note.lineItems ?? []) as LineItem[], -1);
  await db.update(salesReturns).set({ status: "void" }).where(eq(salesReturns.id, id));
  refresh();
}

// ---- applying this note's credit to the party's open invoices

export async function getSalesReturnCredit(noteId: string) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "view")) throw new Error("Not permitted");
  return getCreditInfo(session.tenantId, "sales_return", noteId);
}

export async function applySalesReturnCredit(noteId: string, allocations: { targetId: string; amount: number }[]) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");
  await applyCredit(session.tenantId, session.userId, "sales_return", noteId, allocations);
  refresh();
}

export async function removeSalesReturnCredit(applicationId: string) {
  const session = await requireTenantSession();
  if (!can(session, "sales", "edit")) throw new Error("Not permitted");
  await unapplyCredit(session.tenantId, "sales_return", applicationId);
  refresh();
}
