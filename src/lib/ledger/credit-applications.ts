import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditApplications, purchaseBills, purchaseReturns, salesInvoices, salesReturns } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CreditKind = "sales_return" | "purchase_return";

/**
 * Applying a return's credit against an invoice (sales return) or bill (purchase return). The ledger already
 * reflects the return itself — it reduced what the customer owes / what we owe the supplier — so applying it posts
 * nothing; it only reduces what is still shown as owed on the document, so the document and the ledger agree.
 */

async function loadReturn(tenantId: string, kind: CreditKind, returnId: string) {
  if (kind === "sales_return") {
    const [n] = await db.select().from(salesReturns).where(and(eq(salesReturns.id, returnId), eq(salesReturns.tenantId, tenantId))).limit(1);
    if (!n) throw new Error("Debit note not found");
    return { number: n.noteNumber, partyId: n.customerId, total: Number(n.total), status: n.status as string };
  }
  const [n] = await db.select().from(purchaseReturns).where(and(eq(purchaseReturns.id, returnId), eq(purchaseReturns.tenantId, tenantId))).limit(1);
  if (!n) throw new Error("Credit note not found");
  return { number: n.noteNumber, partyId: n.vendorId, total: Number(n.total), status: n.status as string };
}

async function appliedRows(tenantId: string, returnId: string) {
  return db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.tenantId, tenantId), eq(creditApplications.returnId, returnId), eq(creditApplications.status, "applied")))
    .orderBy(asc(creditApplications.createdAt));
}

// Moves a document's paid amount by `delta` (positive = more is settled) and keeps its status in step.
export async function bumpPaid(tenantId: string, kind: CreditKind, targetId: string, delta: number) {
  if (kind === "sales_return") {
    const [inv] = await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, targetId), eq(salesInvoices.tenantId, tenantId))).limit(1);
    if (!inv) throw new Error("Invoice not found");
    const paid = round2(Math.max(Number(inv.amountPaid) + delta, 0));
    const status = paid <= 0 ? "sent" : paid >= Number(inv.total) - 0.005 ? "paid" : "partially_paid";
    await db.update(salesInvoices).set({ amountPaid: paid.toFixed(2), status }).where(eq(salesInvoices.id, inv.id));
  } else {
    const [bill] = await db.select().from(purchaseBills).where(and(eq(purchaseBills.id, targetId), eq(purchaseBills.tenantId, tenantId))).limit(1);
    if (!bill) throw new Error("Bill not found");
    const paid = round2(Math.max(Number(bill.amountPaid) + delta, 0));
    const status = paid <= 0 ? "open" : paid >= Number(bill.total) - 0.005 ? "paid" : "partially_paid";
    await db.update(purchaseBills).set({ amountPaid: paid.toFixed(2), status }).where(eq(purchaseBills.id, bill.id));
  }
}

/** What a return has to give, what it could be applied to, and what has been applied so far. */
export async function getCreditInfo(tenantId: string, kind: CreditKind, returnId: string) {
  const note = await loadReturn(tenantId, kind, returnId);
  const applications = await appliedRows(tenantId, returnId);
  const applied = round2(applications.reduce((s, a) => s + Number(a.amount), 0));

  const open =
    kind === "sales_return"
      ? (
          await db
            .select()
            .from(salesInvoices)
            .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.customerId, note.partyId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"])))
            .orderBy(asc(salesInvoices.invoiceDate))
        ).map((i) => ({ id: i.id, number: i.invoiceNumber, date: i.invoiceDate, outstanding: round2(Number(i.total) - Number(i.amountPaid)) }))
      : (
          await db
            .select()
            .from(purchaseBills)
            .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.vendorId, note.partyId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"])))
            .orderBy(asc(purchaseBills.billDate))
        ).map((b) => ({ id: b.id, number: b.billNumber, date: b.billDate, outstanding: round2(Number(b.total) - Number(b.amountPaid)) }));

  const numberById = new Map<string, string>();
  if (applications.length > 0) {
    const ids = applications.map((a) => a.targetId);
    const rows =
      kind === "sales_return"
        ? await db.select({ id: salesInvoices.id, n: salesInvoices.invoiceNumber }).from(salesInvoices).where(inArray(salesInvoices.id, ids))
        : await db.select({ id: purchaseBills.id, n: purchaseBills.billNumber }).from(purchaseBills).where(inArray(purchaseBills.id, ids));
    for (const r of rows) numberById.set(r.id, r.n);
  }

  return {
    noteNumber: note.number,
    voided: note.status === "void",
    total: note.total,
    applied,
    available: round2(Math.max(note.total - applied, 0)),
    targets: open.filter((t) => t.outstanding > 0.005),
    applications: applications.map((a) => ({ id: a.id, targetId: a.targetId, targetNumber: numberById.get(a.targetId) ?? "—", amount: Number(a.amount) })),
  };
}

export async function applyCredit(tenantId: string, userId: string, kind: CreditKind, returnId: string, allocations: { targetId: string; amount: number }[]) {
  const note = await loadReturn(tenantId, kind, returnId);
  if (note.status === "void") throw new Error("This note is void — its credit can't be applied");
  const wanted = allocations.filter((a) => a.amount > 0);
  if (wanted.length === 0) throw new Error("Enter an amount against at least one document");

  const info = await getCreditInfo(tenantId, kind, returnId);
  const total = round2(wanted.reduce((s, a) => s + a.amount, 0));
  if (total > info.available + 0.005) throw new Error(`Only ${info.available.toFixed(2)} of credit is left on ${note.number}`);

  const perTarget = new Map<string, number>();
  for (const a of wanted) perTarget.set(a.targetId, round2((perTarget.get(a.targetId) ?? 0) + a.amount));
  for (const [id, value] of perTarget) {
    const target = info.targets.find((t) => t.id === id);
    if (!target) throw new Error("That document isn't open for this party — choose one of the listed documents");
    if (value > target.outstanding + 0.005) throw new Error(`${target.number}: only ${target.outstanding.toFixed(2)} is still owed`);
  }

  const done: [string, number][] = [];
  try {
    for (const [id, value] of perTarget) {
      await bumpPaid(tenantId, kind, id, value);
      done.push([id, value]);
      await db.insert(creditApplications).values({ tenantId, kind, returnId, targetId: id, amount: value.toFixed(2), createdBy: userId });
    }
  } catch (e) {
    for (const [id, value] of done) await bumpPaid(tenantId, kind, id, -value).catch(() => {});
    throw e;
  }
}

export async function unapplyCredit(tenantId: string, kind: CreditKind, applicationId: string) {
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(and(eq(creditApplications.id, applicationId), eq(creditApplications.tenantId, tenantId), eq(creditApplications.kind, kind)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  if (app.status !== "applied") throw new Error("This credit was already taken back");
  await bumpPaid(tenantId, kind, app.targetId, -Number(app.amount));
  await db.update(creditApplications).set({ status: "reversed" }).where(eq(creditApplications.id, app.id));
}

/** A note whose credit has been applied can't be voided until that is taken back. */
export async function assertNoAppliedCredit(tenantId: string, returnId: string, noteNumber: string) {
  const rows = await appliedRows(tenantId, returnId);
  if (rows.length > 0) throw new Error(`The credit on ${noteNumber} has been applied to ${rows.length > 1 ? "documents" : "a document"} — take that back first`);
}
