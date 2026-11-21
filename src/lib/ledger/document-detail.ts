import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, expenses, items, journalEntries, journalLines, paymentAllocations, payments, purchaseBills, purchaseReturns, salesInvoices, salesReturns, vendors } from "@/db/schema";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";

// What the details pop-up of an invoice or a bill shows: the amounts, the items and the payments. Read-only plain helpers; the actions check the permission.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type DocumentDetail = {
  kind: "sale" | "purchase" | "expense" | "sales_return" | "purchase_return";
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  partyId: string | null;
  partyName: string;
  status: string;
  /** Bill type or VAT treatment, in words. */
  typeLabel: string;
  taxable: number;
  vat: number;
  total: number;
  paid: number;
  balance: number;
  detailsPending: boolean;
  /** Expenses only: other tax, TDS withheld, what was payable after it, the category and the description. */
  otherTax?: number;
  tds?: number;
  payable?: number;
  category?: string;
  description?: string;
  lines: { name: string; quantity: number; rate: number; amount: number }[];
  payments: { date: string; mode: string; amount: number }[];
};

/** The detail plus what the person may do with the document, for the pop-up's buttons. */
export type DocumentDetailView = DocumentDetail & { canEdit: boolean; canVoid: boolean; canPay: boolean };

const BILL_TYPE: Record<string, string> = { vat: "VAT bill", pan: "PAN bill", estimate: "Estimate", challan: "Challan", no_bill: "No bill" };
const TREATMENT: Record<string, string> = { taxable: "Taxable", zero_rated: "Zero-rated" };

export async function salesInvoiceDetail(tenantId: string, invoiceId: string): Promise<DocumentDetail | null> {
  const [inv] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.tenantId, tenantId))).limit(1);
  if (!inv) return null;
  const [customer] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.id, inv.customerId), eq(customers.tenantId, tenantId))).limit(1);

  // Paid when the invoice was entered: the receipt entry's own lines. Paid later: the Payments module.
  const embedded = await db
    .select({ date: journalEntries.entryDate, mode: journalLines.paymentModeName, account: accounts.name, amount: journalLines.debitAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, "receipt"), eq(journalEntries.sourceId, invoiceId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId), gt(journalLines.debitAmount, "0")))
    .orderBy(asc(journalEntries.createdAt));
  const later = await db
    .select({ date: payments.paymentDate, mode: payments.paymentModeName, account: accounts.name, amount: paymentAllocations.allocatedAmount })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(accounts, eq(accounts.id, payments.accountId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.origin, "standalone"), ne(payments.status, "voided"), eq(paymentAllocations.targetType, "sales_invoice"), eq(paymentAllocations.targetId, invoiceId)))
    .orderBy(asc(payments.paymentDate));

  const total = Number(inv.total);
  const paid = Number(inv.amountPaid);
  return {
    kind: "sale",
    id: inv.id,
    number: inv.invoiceNumber,
    date: inv.invoiceDate,
    dueDate: inv.dueDate,
    partyId: inv.customerId,
    partyName: customer?.name ?? "",
    status: inv.status,
    typeLabel: TREATMENT[inv.taxTreatment] ?? inv.taxTreatment,
    taxable: Number(inv.subtotal),
    vat: Number(inv.taxAmount),
    total,
    paid,
    balance: inv.status === "void" ? 0 : Math.max(round2(total - paid), 0),
    detailsPending: false,
    lines: (inv.lineItems ?? []).map((l) => ({ name: l.description, quantity: l.quantity, rate: l.unitPrice, amount: round2(l.quantity * l.unitPrice - (l.discount ?? 0)) })),
    payments: [...embedded, ...later].map((p) => ({ date: p.date, mode: p.mode ?? p.account, amount: Number(p.amount) })),
  };
}

export async function purchaseBillDetail(tenantId: string, billId: string): Promise<DocumentDetail | null> {
  const [bill] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.id, billId), eq(purchaseBills.tenantId, tenantId))).limit(1);
  if (!bill) return null;
  const [vendor] = bill.vendorId ? await db.select({ name: vendors.name }).from(vendors).where(and(eq(vendors.id, bill.vendorId), eq(vendors.tenantId, tenantId))).limit(1) : [];
  const lineItems = bill.lineItems ?? [];
  const itemIds = [...new Set(lineItems.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  const itemNames = new Map<string, string>();
  if (itemIds.length > 0) for (const i of await db.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)))) itemNames.set(i.id, i.name);

  const paid = await db
    .select({ date: payments.paymentDate, mode: payments.paymentModeName, account: accounts.name, amount: paymentAllocations.allocatedAmount })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(accounts, eq(accounts.id, payments.accountId))
    .where(and(eq(payments.tenantId, tenantId), ne(payments.status, "voided"), eq(paymentAllocations.targetType, "purchase_bill"), eq(paymentAllocations.targetId, billId)))
    .orderBy(asc(payments.paymentDate));

  const total = Number(bill.total);
  const amountPaid = Number(bill.amountPaid);
  return {
    kind: "purchase",
    id: bill.id,
    number: bill.billNumber,
    date: bill.billDate,
    dueDate: bill.dueDate,
    partyId: bill.vendorId,
    partyName: vendor?.name ?? bill.description ?? "",
    status: bill.status,
    typeLabel: BILL_TYPE[bill.billType] ?? bill.billType,
    taxable: Number(bill.subtotal),
    vat: Number(bill.taxAmount),
    total,
    paid: amountPaid,
    balance: bill.status === "void" ? 0 : Math.max(round2(total - amountPaid), 0),
    detailsPending: bill.detailsPending,
    lines: lineItems.map((l) => ({ name: l.description || (l.itemId ? itemNames.get(l.itemId) ?? "" : "") || "Item", quantity: l.quantity, rate: l.rate, amount: round2(l.quantity * l.rate - l.discount) })),
    payments: paid.map((p) => ({ date: p.date, mode: p.mode ?? p.account, amount: Number(p.amount) })),
  };
}

export async function expenseDetail(tenantId: string, expenseId: string): Promise<DocumentDetail | null> {
  const [e] = await db.select().from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, tenantId))).limit(1);
  if (!e) return null;
  const [vendor] = e.vendorId ? await db.select({ name: vendors.name }).from(vendors).where(and(eq(vendors.id, e.vendorId), eq(vendors.tenantId, tenantId))).limit(1) : [];
  const [category] = await db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, e.categoryAccountId), eq(accounts.tenantId, tenantId))).limit(1);

  // What was paid, from the cash, bank and wallet lines of the expense's own entries (never the reversals of edited or voided ones).
  const cashIds = (await getCashBankAccounts(tenantId)).flatMap((g) => [g.id, ...g.children.map((c) => c.id)]);
  const paid =
    cashIds.length === 0
      ? []
      : await db
          .select({ date: journalEntries.entryDate, mode: journalLines.paymentModeName, account: accounts.name, amount: journalLines.creditAmount })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
          .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalEntries.sourceType, ["expense", "payment"]), eq(journalEntries.sourceId, expenseId), eq(journalEntries.isReversed, false), isNull(journalEntries.reversalOfId), inArray(journalLines.accountId, cashIds), gt(journalLines.creditAmount, "0")))
          .orderBy(asc(journalEntries.createdAt));

  const payable = Number(e.amountPayable);
  const amountPaid = Number(e.amountPaid);
  return {
    kind: "expense",
    id: e.id,
    number: e.expenseNumber,
    date: e.expenseDate,
    dueDate: e.dueDate,
    partyId: e.vendorId,
    partyName: vendor?.name ?? e.payeeName ?? "",
    status: e.status,
    typeLabel: BILL_TYPE[e.billType] ?? e.billType,
    taxable: Number(e.subtotal),
    vat: Number(e.vatAmount),
    total: Number(e.total),
    paid: amountPaid,
    balance: e.status === "void" ? 0 : Math.max(round2(payable - amountPaid), 0),
    detailsPending: false,
    otherTax: Number(e.otherTaxAmount),
    tds: Number(e.tdsAmount),
    payable,
    category: category?.name ?? "",
    description: e.description ?? "",
    lines: [],
    payments: paid.map((p) => ({ date: p.date, mode: p.mode ?? p.account, amount: Number(p.amount) })),
  };
}

export async function salesReturnDetail(tenantId: string, noteId: string): Promise<DocumentDetail | null> {
  const [n] = await db.select().from(salesReturns).where(and(eq(salesReturns.id, noteId), eq(salesReturns.tenantId, tenantId))).limit(1);
  if (!n) return null;
  const [customer] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.id, n.customerId), eq(customers.tenantId, tenantId))).limit(1);
  return {
    kind: "sales_return",
    id: n.id,
    number: n.noteNumber,
    date: n.noteDate,
    dueDate: null,
    partyId: n.customerId,
    partyName: customer?.name ?? "",
    status: n.status,
    typeLabel: "Sales return",
    taxable: Number(n.subtotal),
    vat: Number(n.taxAmount),
    total: Number(n.total),
    paid: 0,
    balance: 0,
    detailsPending: false,
    lines: (n.lineItems ?? []).map((l) => ({ name: l.description, quantity: l.quantity, rate: l.unitPrice, amount: round2(l.quantity * l.unitPrice - (l.discount ?? 0)) })),
    payments: [],
  };
}

export async function purchaseReturnDetail(tenantId: string, noteId: string): Promise<DocumentDetail | null> {
  const [n] = await db.select().from(purchaseReturns).where(and(eq(purchaseReturns.id, noteId), eq(purchaseReturns.tenantId, tenantId))).limit(1);
  if (!n) return null;
  const [vendor] = await db.select({ name: vendors.name }).from(vendors).where(and(eq(vendors.id, n.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  const lineItems = n.lineItems ?? [];
  const itemIds = [...new Set(lineItems.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
  const itemNames = new Map<string, string>();
  if (itemIds.length > 0) for (const i of await db.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)))) itemNames.set(i.id, i.name);
  return {
    kind: "purchase_return",
    id: n.id,
    number: n.noteNumber,
    date: n.noteDate,
    dueDate: null,
    partyId: n.vendorId,
    partyName: vendor?.name ?? "",
    status: n.status,
    typeLabel: "Purchase return",
    taxable: Number(n.subtotal),
    vat: Number(n.taxAmount),
    total: Number(n.total),
    paid: 0,
    balance: 0,
    detailsPending: false,
    lines: lineItems.map((l) => ({ name: l.description || (l.itemId ? itemNames.get(l.itemId) ?? "" : "") || "Item", quantity: l.quantity, rate: l.rate, amount: round2(l.quantity * l.rate - l.discount) })),
    payments: [],
  };
}
