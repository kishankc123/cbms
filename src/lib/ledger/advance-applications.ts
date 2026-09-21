import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { advanceApplications, purchaseBills, salesInvoices } from "@/db/schema";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { getOrCreateCustomerReceivableAccountId, getOrCreateSupplierPayableAccountId } from "./subledger-accounts";
import {
  getCustomerAdvanceBalance,
  getSupplierAdvanceBalance,
  getOrCreateCustomerAdvanceAccountId,
  getOrCreateSupplierAdvanceAccountId,
} from "./advance-accounts";
import { bumpPaid } from "./credit-applications";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { todayIso } from "@/lib/calendar";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AdvanceSide = "customer" | "supplier";

/**
 * Applying an advance settles an invoice (customer) or bill (supplier) out of money that was already received / paid
 * ahead of it. For a customer: Dr their Advance account, Cr their receivable account. For a supplier: Dr their payable
 * account, Cr their Advance account. The document's paid amount and status follow.
 */

async function loadDocument(tenantId: string, side: AdvanceSide, docId: string) {
  if (side === "customer") {
    const [i] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, docId), eq(salesInvoices.tenantId, tenantId))).limit(1);
    if (!i) throw new Error("Invoice not found");
    return { number: i.invoiceNumber, partyId: i.customerId, outstanding: round2(Number(i.total) - Number(i.amountPaid)), void: i.status === "void", date: i.invoiceDate };
  }
  const [b] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.id, docId), eq(purchaseBills.tenantId, tenantId))).limit(1);
  if (!b) throw new Error("Bill not found");
  if (!b.vendorId) throw new Error("This bill has no supplier, so there is no advance to apply");
  return { number: b.billNumber, partyId: b.vendorId, outstanding: round2(Number(b.total) - Number(b.amountPaid)), void: b.status === "void", date: b.billDate };
}

const balanceOf = (tenantId: string, side: AdvanceSide, partyId: string) =>
  side === "customer" ? getCustomerAdvanceBalance(tenantId, partyId) : getSupplierAdvanceBalance(tenantId, partyId);

async function activeApplications(tenantId: string, targetId: string) {
  return db
    .select()
    .from(advanceApplications)
    .where(and(eq(advanceApplications.tenantId, tenantId), eq(advanceApplications.targetId, targetId), eq(advanceApplications.status, "applied")))
    .orderBy(asc(advanceApplications.createdAt));
}

/** What is still owed on a document, what advance the party has, and what has already been applied to it. */
export async function getAdvanceInfo(tenantId: string, side: AdvanceSide, docId: string) {
  const doc = await loadDocument(tenantId, side, docId);
  const apps = await activeApplications(tenantId, docId);
  return {
    number: doc.number,
    voided: doc.void,
    outstanding: doc.outstanding,
    advanceAvailable: await balanceOf(tenantId, side, doc.partyId),
    applications: apps.map((a) => ({ id: a.id, amount: Number(a.amount) })),
  };
}

export async function applyAdvance(tenantId: string, userId: string, side: AdvanceSide, docId: string, amount: number) {
  const doc = await loadDocument(tenantId, side, docId);
  if (doc.void) throw new Error(`${doc.number} is cancelled`);
  const value = round2(amount);
  if (!(value > 0)) throw new Error("Enter the amount of advance to apply");
  if (value > doc.outstanding + 0.005) throw new Error(`Only ${doc.outstanding.toFixed(2)} is still owed on ${doc.number}`);
  const available = await balanceOf(tenantId, side, doc.partyId);
  if (value > available + 0.005) throw new Error(`Only ${Math.max(available, 0).toFixed(2)} of advance is available`);

  const date = todayIso();
  await assertPeriodOpen(tenantId, date);

  const lines =
    side === "customer"
      ? [
          { accountId: await getOrCreateCustomerAdvanceAccountId(tenantId, doc.partyId), debitAmount: value, description: `Advance applied to ${doc.number}` },
          { accountId: await getOrCreateCustomerReceivableAccountId(tenantId, doc.partyId), creditAmount: value, description: `Advance applied to ${doc.number}` },
        ]
      : [
          { accountId: await getOrCreateSupplierPayableAccountId(tenantId, doc.partyId), debitAmount: value, description: `Advance applied to ${doc.number}` },
          { accountId: await getOrCreateSupplierAdvanceAccountId(tenantId, doc.partyId), creditAmount: value, description: `Advance applied to ${doc.number}` },
        ];

  const entry = await postJournalEntry({
    tenantId,
    entryDate: date,
    sourceType: "advance_application",
    sourceId: docId,
    referenceNumber: doc.number,
    memo: `Advance applied to ${side === "customer" ? "invoice" : "bill"} ${doc.number}`,
    createdBy: userId,
    lines,
  });

  const kind = side === "customer" ? "sales_return" : "purchase_return"; // selects invoices vs bills in bumpPaid
  try {
    await bumpPaid(tenantId, kind, docId, value);
    await db.insert(advanceApplications).values({ tenantId, side, partyId: doc.partyId, targetId: docId, amount: value.toFixed(2), journalEntryId: entry.id, createdBy: userId });
  } catch (e) {
    await bumpPaid(tenantId, kind, docId, -value).catch(() => {});
    await reverseJournalEntry(tenantId, entry.id, userId, "Rolled back — advance could not be applied").catch(() => {});
    throw e;
  }
}

/**
 * Puts a party's advance to work: applies it to their OLDEST open documents first, until the advance or the open
 * documents run out. Runs after an invoice / bill is created. It never fails the caller — if something stops it (for
 * example a closed period) the advance is simply left for the person to apply by hand.
 */
export async function autoApplyAdvance(tenantId: string, userId: string, side: AdvanceSide, partyId: string): Promise<number> {
  try {
    let available = await balanceOf(tenantId, side, partyId);
    if (available <= 0.005) return 0;

    const open =
      side === "customer"
        ? (
            await db
              .select()
              .from(salesInvoices)
              .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.customerId, partyId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"])))
              .orderBy(asc(salesInvoices.invoiceDate), asc(salesInvoices.invoiceNumber))
          ).map((i) => ({ id: i.id, outstanding: round2(Number(i.total) - Number(i.amountPaid)) }))
        : (
            await db
              .select()
              .from(purchaseBills)
              .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.vendorId, partyId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"])))
              .orderBy(asc(purchaseBills.billDate), asc(purchaseBills.billNumber))
          ).map((b) => ({ id: b.id, outstanding: round2(Number(b.total) - Number(b.amountPaid)) }));

    let applied = 0;
    for (const doc of open) {
      if (available <= 0.005) break;
      if (doc.outstanding <= 0.005) continue;
      const value = round2(Math.min(available, doc.outstanding));
      await applyAdvance(tenantId, userId, side, doc.id, value);
      available = round2(available - value);
      applied = round2(applied + value);
    }
    return applied;
  } catch {
    return 0;
  }
}

export async function unapplyAdvance(tenantId: string, userId: string, side: AdvanceSide, applicationId: string) {
  const [app] = await db
    .select()
    .from(advanceApplications)
    .where(and(eq(advanceApplications.id, applicationId), eq(advanceApplications.tenantId, tenantId), eq(advanceApplications.side, side)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  if (app.status !== "applied") throw new Error("This advance was already taken back");

  await assertPeriodOpen(tenantId, todayIso());
  await reverseJournalEntry(tenantId, app.journalEntryId, userId, "Advance taken back");
  await bumpPaid(tenantId, side === "customer" ? "sales_return" : "purchase_return", app.targetId, -Number(app.amount));
  await db.update(advanceApplications).set({ status: "reversed" }).where(eq(advanceApplications.id, app.id));
}

/** Advances currently applied to a document (used to stop it being edited or voided underneath them). */
export async function appliedAdvanceAmount(tenantId: string, targetId: string): Promise<number> {
  return round2((await activeApplications(tenantId, targetId)).reduce((s, a) => s + Number(a.amount), 0));
}
