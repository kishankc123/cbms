import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { issuedCheques } from "@/db/schema";

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
