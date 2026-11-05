import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenses, issuedCheques, paymentModeAccounts, paymentModes, purchaseBills, vendors } from "@/db/schema";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { createPayment, voidPayment, type CreatePaymentInput } from "@/lib/ledger/payments-engine";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { nextChequeNumber, validateCheque, validateClearDate, type ChequeInput, type ChequeStatus, type OpenBill, type PayeeKind } from "./cheque-rules";

export * from "./cheque-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export type ChequeListRow = {
  id: string;
  bankAccountId: string;
  bankName: string;
  chequeNumber: string;
  payeeKind: PayeeKind;
  vendorId: string | null;
  expenseId: string | null;
  payeeName: string;
  amount: number;
  issueDate: string;
  chequeDate: string;
  status: ChequeStatus;
  clearedDate: string | null;
  paymentId: string | null;
  closedReason: string | null;
  replacesId: string | null;
  memo: string | null;
};

/** Cheques still waiting to clear (all of them), and the finished ones from the last `closedDays` days. */
export async function listCheques(tenantId: string, closedSince: string): Promise<ChequeListRow[]> {
  const rows = await db
    .select({ c: issuedCheques, bankName: accounts.name })
    .from(issuedCheques)
    .innerJoin(accounts, eq(accounts.id, issuedCheques.bankAccountId))
    .where(and(eq(issuedCheques.tenantId, tenantId), sql`(${issuedCheques.status} = 'issued' or ${issuedCheques.updatedAt} >= ${closedSince}::date)`))
    .orderBy(asc(issuedCheques.chequeDate), asc(issuedCheques.chequeNumber))
    .limit(1000);
  return rows.map(({ c, bankName }) => ({
    id: c.id,
    bankAccountId: c.bankAccountId,
    bankName,
    chequeNumber: c.chequeNumber,
    payeeKind: c.payeeKind as PayeeKind,
    vendorId: c.vendorId,
    expenseId: c.expenseId,
    payeeName: c.payeeName,
    amount: num(c.amount),
    issueDate: c.issueDate,
    chequeDate: c.chequeDate,
    status: c.status as ChequeStatus,
    clearedDate: c.clearedDate,
    paymentId: c.paymentId,
    closedReason: c.closedReason,
    replacesId: c.replacesId,
    memo: c.memo,
  }));
}

/** The bank accounts a cheque can be drawn on: the bank sub-accounts (1010...), not cash. */
export async function chequeBankAccounts(tenantId: string) {
  const rows = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.isActive, true), sql`${accounts.code} like '1010%'`))
    .orderBy(asc(accounts.code));
  // A bank with sub-accounts is only a heading: the cheque is drawn on one of the sub-accounts.
  const headings = new Set(rows.filter((r) => rows.some((o) => o.code !== r.code && o.code.startsWith(r.code + "."))).map((r) => r.id));
  return rows.filter((r) => !headings.has(r.id));
}

/** The cheque numbers already used on a bank account, for suggesting the next one. */
export async function nextNumberFor(tenantId: string, bankAccountId: string): Promise<string> {
  const rows = await db.select({ n: issuedCheques.chequeNumber }).from(issuedCheques).where(and(eq(issuedCheques.tenantId, tenantId), eq(issuedCheques.bankAccountId, bankAccountId)));
  return nextChequeNumber(rows.map((r) => r.n));
}

/** What a supplier still owes on open bills, oldest first, for showing what a cheque would settle. */
export async function supplierOpenBills(tenantId: string, vendorId: string): Promise<OpenBill[]> {
  const rows = await db
    .select({ number: purchaseBills.billNumber, date: purchaseBills.billDate, outstanding: sql<string>`(${purchaseBills.total} - ${purchaseBills.amountPaid})` })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.tenantId, tenantId), eq(purchaseBills.vendorId, vendorId), inArray(purchaseBills.status, ["open", "partially_paid", "overdue"]), sql`(${purchaseBills.total} - ${purchaseBills.amountPaid}) > 0`))
    .orderBy(asc(purchaseBills.billDate), asc(purchaseBills.billNumber));
  return rows.map((r) => ({ number: r.number, date: r.date, outstanding: round2(num(r.outstanding)) }));
}

/** Unpaid expenses a cheque can pay, with what is still open on each after any cheques already written for it. */
export async function unpaidExpenses(tenantId: string) {
  const rows = await db
    .select({ id: expenses.id, number: expenses.expenseNumber, date: expenses.expenseDate, description: expenses.description, vendor: vendors.name, payee: expenses.payeeName, open: sql<string>`(${expenses.amountPayable} - ${expenses.amountPaid})` })
    .from(expenses)
    .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
    .where(and(eq(expenses.tenantId, tenantId), inArray(expenses.status, ["unpaid", "partially_paid"]), sql`(${expenses.amountPayable} - ${expenses.amountPaid}) > 0`))
    .orderBy(desc(expenses.expenseDate))
    .limit(300);
  const committed = await db
    .select({ id: issuedCheques.expenseId, v: sql<string>`sum(${issuedCheques.amount})` })
    .from(issuedCheques)
    .where(and(eq(issuedCheques.tenantId, tenantId), eq(issuedCheques.status, "issued"), eq(issuedCheques.payeeKind, "expense")))
    .groupBy(issuedCheques.expenseId);
  const by = new Map(committed.map((c) => [c.id, num(c.v)]));
  return rows
    .map((r) => ({ id: r.id, number: r.number, date: r.date, label: r.vendor ?? r.payee ?? r.description ?? "Expense", open: round2(num(r.open) - (by.get(r.id) ?? 0)) }))
    .filter((r) => r.open > 0.005);
}

/** Writes a cheque into the register. Nothing is posted to the ledger: that happens when it clears. */
export async function issueCheque(tenantId: string, userId: string, input: ChequeInput, today: string): Promise<{ id: string }> {
  const problem = validateCheque(input, today);
  if (problem) throw new Error(problem);

  const banks = await chequeBankAccounts(tenantId);
  const bank = banks.find((b) => b.id === input.bankAccountId);
  if (!bank) throw new Error("That is not a bank account this organization can draw cheques on.");

  let payeeName: string;
  if (input.payeeKind === "supplier") {
    const [v] = await db.select({ name: vendors.name }).from(vendors).where(and(eq(vendors.id, input.vendorId!), eq(vendors.tenantId, tenantId))).limit(1);
    if (!v) throw new Error("That supplier could not be found.");
    payeeName = v.name;
  } else {
    const open = (await unpaidExpenses(tenantId)).find((e) => e.id === input.expenseId);
    if (!open) throw new Error("That expense is not open to pay, or cheques already cover all of it.");
    if (input.amount > open.open + 0.005) throw new Error(`A cheque for that expense can be at most ${open.open.toFixed(2)}, which is what is still open after other cheques.`);
    const [e] = await db.select({ vendor: vendors.name, payee: expenses.payeeName, number: expenses.expenseNumber }).from(expenses).leftJoin(vendors, eq(vendors.id, expenses.vendorId)).where(and(eq(expenses.id, input.expenseId!), eq(expenses.tenantId, tenantId))).limit(1);
    payeeName = e?.vendor ?? e?.payee ?? `Expense ${e?.number ?? ""}`.trim();
  }

  if (input.replacesId) {
    const [old] = await db.select({ status: issuedCheques.status }).from(issuedCheques).where(and(eq(issuedCheques.id, input.replacesId), eq(issuedCheques.tenantId, tenantId))).limit(1);
    if (!old || (old.status !== "bounced" && old.status !== "stopped")) throw new Error("Only a bounced or stopped cheque can be replaced.");
  }

  try {
    const [row] = await db
      .insert(issuedCheques)
      .values({
        tenantId,
        bankAccountId: input.bankAccountId,
        chequeNumber: input.chequeNumber.trim(),
        payeeKind: input.payeeKind,
        vendorId: input.payeeKind === "supplier" ? input.vendorId : null,
        expenseId: input.payeeKind === "expense" ? input.expenseId : null,
        payeeName,
        amount: input.amount.toFixed(2),
        issueDate: input.issueDate,
        chequeDate: input.chequeDate,
        memo: input.memo?.trim() || null,
        replacesId: input.replacesId,
        createdBy: userId,
      })
      .returning({ id: issuedCheques.id });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Cheque ${input.chequeNumber.trim()} has already been used on ${bank.name}. Cheque numbers are used once, even for a cheque that was stopped or came back.`);
    throw e;
  }
}

async function chequeModeId(tenantId: string, bankAccountId: string): Promise<string | null> {
  const [m] = await db
    .select({ id: paymentModes.id })
    .from(paymentModes)
    .innerJoin(paymentModeAccounts, eq(paymentModeAccounts.modeId, paymentModes.id))
    .where(and(eq(paymentModes.tenantId, tenantId), eq(paymentModes.isActive, true), ilike(paymentModes.name, "%cheque%"), eq(paymentModeAccounts.accountId, bankAccountId)))
    .limit(1);
  return m?.id ?? null;
}

/**
 * The cheque has been paid by the bank: the payment is posted through the normal payment engine, dated the day it cleared. A supplier's
 * bills are settled from it oldest first, as for any supplier payment. If posting fails the cheque goes back to issued and nothing is left behind.
 */
export async function clearCheque(tenantId: string, userId: string, chequeId: string, clearedDate: string, today: string): Promise<{ paymentId: string | null }> {
  const [cheque] = await db.select().from(issuedCheques).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId))).limit(1);
  if (!cheque) throw new Error("That cheque could not be found.");
  if (cheque.status !== "issued") throw new Error("This cheque is not waiting to clear.");
  const problem = validateClearDate(clearedDate, cheque.chequeDate, today);
  if (problem) throw new Error(problem);
  await assertPeriodOpen(tenantId, clearedDate);

  // Claim it first, so two people clearing at once cannot post it twice.
  const claimed = await db.update(issuedCheques).set({ status: "cleared", clearedDate, updatedAt: new Date() }).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId), eq(issuedCheques.status, "issued"))).returning({ id: issuedCheques.id });
  if (claimed.length === 0) throw new Error("This cheque was cleared or closed a moment ago. Refresh to see its state.");

  try {
    const [bank] = await db.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, cheque.bankAccountId), eq(accounts.tenantId, tenantId))).limit(1);
    const base = {
      direction: "money_out" as const,
      paymentDate: clearedDate,
      accountId: cheque.bankAccountId,
      paymentModeId: await chequeModeId(tenantId, cheque.bankAccountId),
      paymentMethod: "cheque" as const,
      chequeNumber: cheque.chequeNumber,
      chequeDate: cheque.chequeDate,
      chequeBank: bank?.name ?? null,
      amount: num(cheque.amount),
      description: `Cheque ${cheque.chequeNumber} to ${cheque.payeeName}`,
      notes: cheque.memo,
      confirmDuplicate: true,
    };
    const input: CreatePaymentInput =
      cheque.payeeKind === "supplier"
        ? { ...base, paymentType: "supplier_payment", partyType: "supplier", vendorId: cheque.vendorId }
        : { ...base, paymentType: "expense_payment", partyType: "none", allocations: [{ targetType: "expense", targetId: cheque.expenseId!, allocatedAmount: num(cheque.amount) }] };
    const paymentNumber = await buildNextPaymentNumber(tenantId, "money_out");
    const result = await createPayment(tenantId, userId, paymentNumber, input);
    const paymentId = "paymentId" in result ? result.paymentId : null;
    await db.update(issuedCheques).set({ paymentId, updatedAt: new Date() }).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId)));
    return { paymentId };
  } catch (e) {
    await db.update(issuedCheques).set({ status: "issued", clearedDate: null, updatedAt: new Date() }).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId)));
    throw e;
  }
}

/**
 * A cheque that never cleared is stopped (cancelled with the bank) or came back unpaid (bounced). Nothing was posted, so nothing is undone.
 * A cheque that had cleared and was then returned by the bank has its payment voided, which reopens what it had settled.
 */
export async function closeCheque(tenantId: string, userId: string, chequeId: string, how: "stopped" | "bounced", reason: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new Error("Give a reason, so the record explains itself later.");
  if (why.length > 300) throw new Error("The reason is too long.");
  const [cheque] = await db.select().from(issuedCheques).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId))).limit(1);
  if (!cheque) throw new Error("That cheque could not be found.");

  if (cheque.status === "issued") {
    const done = await db.update(issuedCheques).set({ status: how, closedReason: why, updatedAt: new Date() }).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId), eq(issuedCheques.status, "issued"))).returning({ id: issuedCheques.id });
    if (done.length === 0) throw new Error("This cheque changed a moment ago. Refresh to see its state.");
    return;
  }
  if (cheque.status === "cleared" && how === "bounced" && cheque.paymentId) {
    await voidPayment(tenantId, cheque.paymentId, userId, `Cheque ${cheque.chequeNumber} returned by the bank: ${why}`);
    await db.update(issuedCheques).set({ status: "bounced", closedReason: why, updatedAt: new Date() }).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, tenantId)));
    return;
  }
  throw new Error(cheque.status === "cleared" ? "A cleared cheque can only be marked as returned by the bank." : "This cheque is already closed.");
}

