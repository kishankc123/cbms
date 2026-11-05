import { and, eq, inArray, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { issuedCheques, journalLines, payments, receivedCheques } from "@/db/schema";
import { voidPayment } from "@/lib/ledger/payments-engine";
import { clearCheque } from "./cheques";
import { clearReceived } from "./received";
import { scoreChequeCandidate, type ChequeCandidate, type StatementLineInput } from "./reconcile-rules";

export * from "./reconcile-rules";

const num = (v: unknown) => Number(v ?? 0);

/**
 * For each unmatched bank line, the cheques that could be it: cheques we wrote that have not cleared (money out) and cheques we were
 * given that are held or deposited (money in), on this bank account. The best few per line, best first.
 */
export async function chequeCandidatesForLines(tenantId: string, bankChartId: string, lines: (StatementLineInput & { id: string })[]): Promise<Record<string, ChequeCandidate[]>> {
  if (lines.length === 0) return {};
  const [issued, received] = await Promise.all([
    db.select().from(issuedCheques).where(and(eq(issuedCheques.tenantId, tenantId), eq(issuedCheques.status, "issued"), eq(issuedCheques.bankAccountId, bankChartId))),
    db.select().from(receivedCheques).where(and(eq(receivedCheques.tenantId, tenantId), inArray(receivedCheques.status, ["received", "deposited"]), or(isNull(receivedCheques.depositAccountId), eq(receivedCheques.depositAccountId, bankChartId)))),
  ]);
  const out: Record<string, ChequeCandidate[]> = {};
  for (const line of lines) {
    const found: ChequeCandidate[] = [];
    for (const c of issued) {
      const s = scoreChequeCandidate(line, { kind: "issued", number: c.chequeNumber, amount: num(c.amount), chequeDate: c.chequeDate });
      if (s) found.push({ kind: "issued", chequeId: c.id, chequeNumber: c.chequeNumber, party: c.payeeName, amount: num(c.amount), chequeDate: c.chequeDate, ...s });
    }
    for (const c of received) {
      const s = scoreChequeCandidate(line, { kind: "received", number: c.chequeNumber, amount: num(c.amount), chequeDate: c.chequeDate, depositedDate: c.depositedDate });
      if (s) found.push({ kind: "received", chequeId: c.id, chequeNumber: c.chequeNumber, party: c.payerName, amount: num(c.amount), chequeDate: c.chequeDate, ...s });
    }
    if (found.length > 0) out[line.id] = found.sort((a, b) => b.score - a.score).slice(0, 5);
  }
  return out;
}

/**
 * The bank has paid a cheque, and this bank line is the proof. The cheque is cleared on the day of the line (the payment or receipt is
 * posted through the normal engine) and that posting is matched to the line. `matchLine` does the matching, so it goes through the same
 * checks as any other match. If the match cannot be made, the clearing is taken back and the cheque returns to where it was.
 */
export async function matchChequeToLine(
  tenantId: string,
  userId: string,
  input: { bankChartId: string; line: { id: string; date: string; amount: number }; kind: "issued" | "received"; chequeId: string },
  today: string,
  matchLine: (journalLineId: string) => Promise<void>
): Promise<{ paymentId: string }> {
  const { bankChartId, line, kind, chequeId } = input;
  const cents = Math.round(Math.abs(line.amount) * 100);
  let undo: () => Promise<void>;
  let paymentId: string | null;

  if (kind === "issued") {
    const [c] = await db.select().from(issuedCheques).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId))).limit(1);
    if (!c) throw new Error("That cheque could not be found.");
    if (c.status !== "issued") throw new Error("This cheque is not waiting to clear.");
    if (c.bankAccountId !== bankChartId) throw new Error("This cheque is drawn on a different bank account.");
    if (line.amount >= 0 || Math.round(num(c.amount) * 100) !== cents) throw new Error("The amount on the bank line is not the amount of this cheque.");
    ({ paymentId } = await clearCheque(tenantId, userId, chequeId, line.date, today));
    undo = async () => {
      await db.update(issuedCheques).set({ status: "issued", clearedDate: null, paymentId: null, updatedAt: new Date() }).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId)));
    };
  } else {
    const [c] = await db.select().from(receivedCheques).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId))).limit(1);
    if (!c) throw new Error("That cheque could not be found.");
    if (c.status !== "received" && c.status !== "deposited") throw new Error("This cheque is not waiting to clear.");
    if (c.depositAccountId && c.depositAccountId !== bankChartId) throw new Error("This cheque was deposited into a different bank account.");
    if (line.amount <= 0 || Math.round(num(c.amount) * 100) !== cents) throw new Error("The amount on the bank line is not the amount of this cheque.");
    const before = { status: c.status, depositAccountId: c.depositAccountId, depositedDate: c.depositedDate };
    ({ paymentId } = await clearReceived(tenantId, userId, chequeId, bankChartId, line.date, today));
    undo = async () => {
      await db.update(receivedCheques).set({ ...before, clearedDate: null, paymentId: null, updatedAt: new Date() }).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId)));
    };
  }
  if (!paymentId) throw new Error("The cheque was cleared but no payment was recorded. Check Payments.");

  try {
    const [pay] = await db.select({ journalEntryId: payments.journalEntryId }).from(payments).where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId))).limit(1);
    const lines = pay?.journalEntryId ? await db.select({ id: journalLines.id, debit: journalLines.debitAmount, credit: journalLines.creditAmount }).from(journalLines).where(and(eq(journalLines.journalEntryId, pay.journalEntryId), eq(journalLines.accountId, bankChartId))) : [];
    const bankLine = lines.find((l) => Math.round(Math.abs(num(l.debit) - num(l.credit)) * 100) === cents);
    if (!bankLine) throw new Error("The payment was recorded, but its bank posting could not be found.");
    await matchLine(bankLine.id);
  } catch (e) {
    // Take the clearing back so the cheque, the books and the bank line are all as they were.
    try {
      await voidPayment(tenantId, paymentId, userId, "The bank line could not be matched, so the cheque clearing was taken back.");
      await undo();
    } catch {
      throw new Error("The cheque was cleared but the bank line could not be matched, and the clearing could not be taken back. Check the payment in Payments before trying again.");
    }
    throw e;
  }
  return { paymentId };
}
