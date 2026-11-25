import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankReconciliationMatchLines, bankReconciliationMatches, bankReconciliations, bankStatementImports, bankStatementLines } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";

export type StatementImportRow = {
  id: string;
  fileName: string | null;
  uploadedAt: string;
  periodStart: string;
  periodEnd: string;
  rows: number;
  /** Lines already matched to the books. */
  matched: number;
  /** A signed-off reconciliation covers the statement's dates. */
  signedOff: boolean;
  /** Why it can't be deleted now, or null when it can. */
  blockedBecause: string | null;
};

/** Lines of the given imports that are matched: marked matched, or still in a match that has not been undone. */
async function matchedCounts(tenantId: string, importIds: string[]): Promise<Map<string, number>> {
  if (importIds.length === 0) return new Map();
  const rows = await db
    .select({ importId: bankStatementLines.importId, n: count() })
    .from(bankStatementLines)
    .where(
      and(
        eq(bankStatementLines.tenantId, tenantId),
        inArray(bankStatementLines.importId, importIds),
        sql`(${bankStatementLines.matchStatus} = 'matched' or exists (
          select 1 from ${bankReconciliationMatchLines} ml
          join ${bankReconciliationMatches} m on m.id = ml.match_id
          where ml.statement_line_id = ${bankStatementLines.id} and m.unmatched_at is null
        ))`
      )
    )
    .groupBy(bankStatementLines.importId);
  return new Map(rows.map((r) => [r.importId, Number(r.n)]));
}

/** The statements uploaded for a bank account, newest first, with whether each can be deleted. */
export async function listStatementImports(tenantId: string, bankAccountId: string): Promise<StatementImportRow[]> {
  const imports = await db
    .select()
    .from(bankStatementImports)
    .where(and(eq(bankStatementImports.tenantId, tenantId), eq(bankStatementImports.bankAccountId, bankAccountId)))
    .orderBy(desc(bankStatementImports.importDate));
  if (imports.length === 0) return [];
  const [totals, matched, signed] = await Promise.all([
    db
      .select({ importId: bankStatementLines.importId, n: count() })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.tenantId, tenantId), inArray(bankStatementLines.importId, imports.map((i) => i.id))))
      .groupBy(bankStatementLines.importId),
    matchedCounts(tenantId, imports.map((i) => i.id)),
    db
      .select({ start: bankReconciliations.periodStart, end: bankReconciliations.periodEnd })
      .from(bankReconciliations)
      .where(and(eq(bankReconciliations.tenantId, tenantId), eq(bankReconciliations.bankAccountId, bankAccountId), eq(bankReconciliations.status, "reconciled"))),
  ]);
  const rowCount = new Map(totals.map((t) => [t.importId, Number(t.n)]));
  return imports.map((i) => {
    const matchedN = matched.get(i.id) ?? 0;
    const signedOff = signed.some((s) => s.start <= i.statementPeriodEnd && s.end >= i.statementPeriodStart);
    return {
      id: i.id,
      fileName: i.fileName,
      uploadedAt: i.importDate.toISOString(),
      periodStart: i.statementPeriodStart,
      periodEnd: i.statementPeriodEnd,
      rows: rowCount.get(i.id) ?? 0,
      matched: matchedN,
      signedOff,
      blockedBecause: signedOff ? "A reconciliation covering these dates has been marked reconciled. Reopen it first." : matchedN > 0 ? `${matchedN} ${matchedN === 1 ? "line is" : "lines are"} matched to your books. Unmatch ${matchedN === 1 ? "it" : "them"} first.` : null,
    };
  });
}

/**
 * Removes an uploaded statement and its lines so a corrected file can be uploaded again. Only when none of its lines is matched and no signed-off
 * reconciliation covers its dates. Nothing in the ledger is touched: only the statement rows go.
 */
export async function deleteStatementImport(tenantId: string, userId: string, importId: string): Promise<{ removed: number }> {
  const [imp] = await db.select().from(bankStatementImports).where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.tenantId, tenantId))).limit(1);
  if (!imp) throw new Error("That statement was not found.");
  const row = (await listStatementImports(tenantId, imp.bankAccountId)).find((r) => r.id === importId);
  if (row?.blockedBecause) throw new Error(row.blockedBecause);

  const removed = await db.transaction(async (tx) => {
    const gone = await tx.delete(bankStatementLines).where(and(eq(bankStatementLines.importId, importId), eq(bankStatementLines.tenantId, tenantId))).returning({ id: bankStatementLines.id });
    await tx.delete(bankStatementImports).where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.tenantId, tenantId)));
    return gone.length;
  });
  await logAuditEvent({
    tenantId,
    userId,
    action: "bank_statement_deleted",
    entityType: "bank_statement_import",
    entityId: importId,
    before: { file: imp.fileName ?? "—", from: imp.statementPeriodStart, to: imp.statementPeriodEnd, lines: removed },
    after: {},
  });
  return { removed };
}
