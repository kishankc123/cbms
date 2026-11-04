"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts, bankReconciliations, bankStatementLines } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { chequeCandidatesForLines, matchChequeToLine, type ChequeCandidate } from "@/lib/cheques/reconcile";
import { confirmMatch } from "./actions";

/** For every unmatched bank line, the cheques not yet cleared in the books that it could be. */
export async function getChequeMatchesForAccount(bankAccountId: string): Promise<Record<string, ChequeCandidate[]>> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "view")) throw new Error("Not permitted");
  const [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.tenantId, session.tenantId))).limit(1);
  if (!bank) throw new Error("Bank account not found");
  const lines = await db
    .select()
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.tenantId, session.tenantId), eq(bankStatementLines.bankAccountId, bankAccountId), eq(bankStatementLines.matchStatus, "unmatched")));
  return chequeCandidatesForLines(
    session.tenantId,
    bank.chartOfAccountsLink,
    lines.map((l) => ({ id: l.id, date: l.transactionDate, amount: Number(l.amount), description: l.description ?? "", reference: l.reference ?? "" }))
  );
}

/**
 * Confirms that a bank line is a cheque clearing. This records the payment or receipt the cheque stands for (dated the day of the bank line),
 * and matches it to the line, in one step. It needs the right to reconcile and the right to record payments.
 */
export async function confirmChequeMatch(input: { bankAccountId: string; statementLineId: string; kind: "issued" | "received"; chequeId: string; score?: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) return { ok: false, error: "You do not have permission to reconcile." };
  if (!can(session, "payments", "create")) return { ok: false, error: "You do not have permission to record payments, which clearing a cheque does." };
  try {
    const [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.tenantId, session.tenantId))).limit(1);
    if (!bank) return { ok: false, error: "Bank account not found." };
    const [line] = await db
      .select()
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.id, input.statementLineId), eq(bankStatementLines.tenantId, session.tenantId), eq(bankStatementLines.bankAccountId, bank.id)))
      .limit(1);
    if (!line) return { ok: false, error: "That bank line could not be found." };
    if (line.matchStatus === "matched") return { ok: false, error: "That bank line is already matched." };

    // Checked before anything is posted, so a line inside a reconciled period never causes a payment that cannot be matched.
    const [locked] = await db
      .select({ id: bankReconciliations.id })
      .from(bankReconciliations)
      .where(and(eq(bankReconciliations.bankAccountId, bank.id), eq(bankReconciliations.status, "reconciled"), lte(bankReconciliations.periodStart, line.transactionDate), gte(bankReconciliations.periodEnd, line.transactionDate)))
      .limit(1);
    if (locked) return { ok: false, error: `${line.transactionDate} falls inside a reconciled period. Reopen that reconciliation first.` };

    await matchChequeToLine(
      session.tenantId,
      session.userId,
      { bankChartId: bank.chartOfAccountsLink, line: { id: line.id, date: line.transactionDate, amount: Number(line.amount) }, kind: input.kind, chequeId: input.chequeId },
      todayIso(),
      (journalLineId) => confirmMatch({ bankAccountId: bank.id, statementLineIds: [line.id], journalLineIds: [journalLineId], matchType: "suggested", confidence: input.score })
    );
    for (const path of ["/bank-reconciliation", "/payments", "/payments/cheques", "/payments/cheques-received", "/dashboard", "/journal"]) revalidatePath(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The cheque could not be matched. Please try again." };
  }
}
