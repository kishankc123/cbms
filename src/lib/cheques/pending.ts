import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { issuedCheques, receivedCheques } from "@/db/schema";

// The cheques that are written and not yet cleared, in the small shape the cash forecast and the dashboard need. Kept apart from the
// register's own code so the dashboard can read it without pulling in the payment engine.

export type PendingCheque = {
  id: string;
  chequeNumber: string;
  payeeKind: "supplier" | "expense";
  vendorId: string | null;
  expenseId: string | null;
  payeeName: string;
  amount: number;
  chequeDate: string;
};

export async function pendingCheques(tenantId: string): Promise<PendingCheque[]> {
  const rows = await db
    .select({ id: issuedCheques.id, chequeNumber: issuedCheques.chequeNumber, payeeKind: issuedCheques.payeeKind, vendorId: issuedCheques.vendorId, expenseId: issuedCheques.expenseId, payeeName: issuedCheques.payeeName, amount: issuedCheques.amount, chequeDate: issuedCheques.chequeDate })
    .from(issuedCheques)
    .where(and(eq(issuedCheques.tenantId, tenantId), eq(issuedCheques.status, "issued")))
    .orderBy(asc(issuedCheques.chequeDate))
    .limit(1000);
  return rows.map((r) => ({ ...r, payeeKind: r.payeeKind as PendingCheque["payeeKind"], amount: Number(r.amount) }));
}

export type PendingReceived = {
  id: string;
  chequeNumber: string;
  customerId: string;
  payerName: string;
  amount: number;
  chequeDate: string;
  /** received (still held) or deposited (at the bank). */
  status: "received" | "deposited";
};

/** Cheques from customers that are held or at the bank and have not cleared. */
export async function pendingReceivedCheques(tenantId: string): Promise<PendingReceived[]> {
  const rows = await db
    .select({ id: receivedCheques.id, chequeNumber: receivedCheques.chequeNumber, customerId: receivedCheques.customerId, payerName: receivedCheques.payerName, amount: receivedCheques.amount, chequeDate: receivedCheques.chequeDate, status: receivedCheques.status })
    .from(receivedCheques)
    .where(and(eq(receivedCheques.tenantId, tenantId), inArray(receivedCheques.status, ["received", "deposited"])))
    .orderBy(asc(receivedCheques.chequeDate))
    .limit(1000);
  return rows.map((r) => ({ ...r, amount: Number(r.amount), status: r.status as PendingReceived["status"] }));
}
