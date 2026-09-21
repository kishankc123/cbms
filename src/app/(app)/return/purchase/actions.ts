"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { purchaseReturns, tenants, vendors, items, type PurchaseLineItem } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getCreditInfo, applyCredit, unapplyCredit, assertNoAppliedCredit } from "@/lib/ledger/credit-applications";
import { applyStockDelta } from "@/lib/inventory/stock";
import { inputVatClaimable } from "@/lib/purchases/vat";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PurchaseReturnInput = {
  noteNumber: string;
  noteDate: string;
  vendorId: string;
  /** True when the goods came on a VAT bill, so the input VAT is claimed back too. */
  withVat: boolean;
  lines: PurchaseLineItem[];
};

function computeLine(line: PurchaseLineItem, vatRate: number) {
  const gross = round2(line.rate * line.quantity);
  const discount = round2(Math.min(Math.max(line.discount, 0), gross));
  const taxable = round2(gross - discount);
  const vat = round2(taxable * (vatRate / 100));
  return { gross, discount, taxable, vat };
}

function refresh() {
  for (const p of ["/return/purchase", "/purchases", "/purchases/stockable", "/dashboard", "/journal", "/suppliers", "/inventory/items", "/chart-of-accounts"]) revalidatePath(p);
}

/**
 * Records a purchase return (credit note to the supplier): goods sent back. It undoes part of a purchase:
 *   Dr the supplier's payable account (total)  /  Cr Inventory (taxable) + Cr Tax Receivable (input VAT)
 * and takes the quantity out of stock.
 */
export async function createPurchaseReturn(input: PurchaseReturnInput) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");

  const noteNumber = input.noteNumber.trim();
  if (!noteNumber) throw new Error("Credit note number is required");
  if (!input.vendorId) throw new Error("Select a supplier");
  if (!input.noteDate) throw new Error("Date is required");

  const [vendor] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, session.tenantId)))
    .limit(1);
  if (!vendor) throw new Error("Supplier not found");

  const [dupe] = await db
    .select({ id: purchaseReturns.id })
    .from(purchaseReturns)
    .where(and(eq(purchaseReturns.tenantId, session.tenantId), eq(purchaseReturns.noteNumber, noteNumber)))
    .limit(1);
  if (dupe) throw new Error(`Credit note number ${noteNumber} is already used`);

  await assertPeriodOpen(session.tenantId, input.noteDate);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const vatRate = input.withVat ? parseFloat(tenant?.vatRate ?? "0") || 0 : 0;

  const validLines = input.lines.filter((l) => l.quantity > 0 && l.rate > 0);
  if (validLines.length === 0) throw new Error("Add at least one item line");

  // You can't send back more than you hold.
  const wanted = new Map<string, number>();
  for (const l of validLines) if (l.itemId) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.quantity);
  if (wanted.size > 0) {
    const stock = await db
      .select({ id: items.id, name: items.name, qty: items.stockQuantity })
      .from(items)
      .where(and(eq(items.tenantId, session.tenantId), inArray(items.id, [...wanted.keys()])));
    for (const s of stock) {
      if (Number(s.qty) < (wanted.get(s.id) ?? 0)) throw new Error(`Only ${Number(s.qty)} of ${s.name} in stock — can't return ${wanted.get(s.id)}`);
    }
  }

  const computed = validLines.map((l) => computeLine(l, vatRate));
  const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
  const taxAmount = round2(computed.reduce((s, c) => s + c.vat, 0));
  const total = round2(subtotal + taxAmount);

  const apId = await getOrCreateSupplierPayableAccountId(session.tenantId, input.vendorId);
  const inventory = await findControlAccount(session.tenantId, ["1200"], "Inventory");
  if (!inventory) throw new Error("No Inventory account found — add one to the Chart of Accounts first");
  // Without a VAT registration the VAT on the original purchase was part of the cost, so it comes back off Inventory.
  const claimable = await inputVatClaimable(session.tenantId);
  let taxReceivableId: string | null = null;
  if (taxAmount > 0 && claimable) {
    const tax = await findControlAccount(session.tenantId, ["1300"], "Tax Receivable");
    if (!tax) throw new Error("No Tax Receivable account found — add one to the Chart of Accounts first");
    taxReceivableId = tax.id;
  }

  const [note] = await db
    .insert(purchaseReturns)
    .values({
      tenantId: session.tenantId,
      vendorId: input.vendorId,
      noteNumber,
      noteDate: input.noteDate,
      lineItems: validLines,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
    })
    .returning();

  try {
    const lines: PostLineInput[] = [
      { accountId: apId, debitAmount: total, description: `Credit note ${noteNumber}` },
      { accountId: inventory.id, creditAmount: taxReceivableId ? subtotal : total, description: `Purchase return ${noteNumber}` },
    ];
    if (taxAmount > 0 && taxReceivableId) lines.push({ accountId: taxReceivableId, creditAmount: taxAmount, description: `Tax on purchase return ${noteNumber}` });
    await postJournalEntry({
      tenantId: session.tenantId,
      entryDate: input.noteDate,
      sourceType: "purchase_return",
      sourceId: note.id,
      referenceNumber: noteNumber,
      memo: `Purchase return ${noteNumber}`,
      createdBy: session.userId,
      lines,
    });
  } catch (e) {
    // Nothing was booked, so don't leave the document behind without its accounting.
    await db.delete(purchaseReturns).where(eq(purchaseReturns.id, note.id));
    throw e;
  }

  await applyStockDelta(session.tenantId, validLines, -1);
  refresh();
}

/** Voids a credit note: reverses what it posted and puts the goods back into stock. */
export async function voidPurchaseReturn(formData: FormData) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "delete")) throw new Error("Not permitted");

  const id = String(formData.get("noteId"));
  const [note] = await db
    .select()
    .from(purchaseReturns)
    .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.tenantId, session.tenantId)))
    .limit(1);
  if (!note) throw new Error("Credit note not found");
  if (note.status === "void") throw new Error("Credit note is already void");

  await assertNoAppliedCredit(session.tenantId, note.id, note.noteNumber);
  await reverseAllActiveEntriesForSource(session.tenantId, note.id, session.userId, `Void of credit note ${note.noteNumber}`);
  await applyStockDelta(session.tenantId, (note.lineItems ?? []) as PurchaseLineItem[], 1);
  await db.update(purchaseReturns).set({ status: "void" }).where(eq(purchaseReturns.id, id));
  refresh();
}

// ---- applying this note's credit to the party's open bills

export async function getPurchaseReturnCredit(noteId: string) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "view")) throw new Error("Not permitted");
  return getCreditInfo(session.tenantId, "purchase_return", noteId);
}

export async function applyPurchaseReturnCredit(noteId: string, allocations: { targetId: string; amount: number }[]) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");
  await applyCredit(session.tenantId, session.userId, "purchase_return", noteId, allocations);
  refresh();
}

export async function removePurchaseReturnCredit(applicationId: string) {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "edit")) throw new Error("Not permitted");
  await unapplyCredit(session.tenantId, "purchase_return", applicationId);
  refresh();
}
