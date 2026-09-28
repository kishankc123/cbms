import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts, bankReconciliations, users } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReconciliationReportRow = {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  periodStart: string;
  periodEnd: string;
  statementBalance: number;
  ledgerBalance: number;
  difference: number;
  status: "in_progress" | "reconciled" | "reopened";
  reconciledByName: string | null;
  reconciledAt: string | null;
  reopenReason: string | null;
};

/**
 * Packages the existing reconciliation workflow's own record (bank_reconciliations — one row per
 * "Mark Reconciled" or reopen, already the audit trail the workspace itself relies on) as a report,
 * rather than deriving a new number: every period a bank account was reconciled or reopened, in one place.
 */
export async function bankReconciliationReport(tenantId: string): Promise<ReconciliationReportRow[]> {
  const rows = await db
    .select({
      id: bankReconciliations.id,
      bankAccountId: bankReconciliations.bankAccountId,
      bankAccountName: bankAccounts.accountName,
      periodStart: bankReconciliations.periodStart,
      periodEnd: bankReconciliations.periodEnd,
      statementBalance: bankReconciliations.statementBalance,
      ledgerBalance: bankReconciliations.ledgerBalance,
      status: bankReconciliations.status,
      reconciledBy: bankReconciliations.reconciledBy,
      reconciledAt: bankReconciliations.reconciledAt,
      reopenReason: bankReconciliations.reopenReason,
    })
    .from(bankReconciliations)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankReconciliations.bankAccountId))
    .where(and(eq(bankReconciliations.tenantId, tenantId)))
    .orderBy(asc(bankAccounts.accountName), desc(bankReconciliations.periodEnd));

  const userIds = [...new Set(rows.map((r) => r.reconciledBy).filter((x): x is string => Boolean(x)))];
  const userRows = userIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
  const nameById = new Map(userRows.map((u) => [u.id, u.name]));

  return rows.map((r) => {
    const statementBalance = Number(r.statementBalance);
    const ledgerBalance = Number(r.ledgerBalance);
    return {
      id: r.id,
      bankAccountId: r.bankAccountId,
      bankAccountName: r.bankAccountName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      statementBalance,
      ledgerBalance,
      difference: round2(statementBalance - ledgerBalance),
      status: r.status,
      reconciledByName: r.reconciledBy ? (nameById.get(r.reconciledBy) ?? "—") : null,
      reconciledAt: r.reconciledAt ? r.reconciledAt.toISOString().slice(0, 10) : null,
      reopenReason: r.reopenReason,
    };
  });
}
