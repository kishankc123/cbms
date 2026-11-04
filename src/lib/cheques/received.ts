import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, paymentModeAccounts, paymentModes, receivedCheques, salesInvoices } from "@/db/schema";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { createPayment, voidPayment, type CreatePaymentInput } from "@/lib/ledger/payments-engine";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { chequeBankAccounts, type OpenBill } from "./cheques";
import { validateDeposit, validateReceived, validateReceivedClear, type ReceivedInput, type ReceivedStatus } from "./received-rules";

export * from "./received-rules";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export type ReceivedListRow = {
  id: string;
  customerId: string;
  payerName: string;
  drawerBank: string;
  chequeNumber: string;
  amount: number;
  receivedDate: string;
  chequeDate: string;
  status: ReceivedStatus;
  depositAccountId: string | null;
  depositBank: string | null;
  depositedDate: string | null;
  clearedDate: string | null;
  paymentId: string | null;
  closedReason: string | null;
  memo: string | null;
};

/** Cheques still held or at the bank (all of them), and the finished ones from the last `closedSince` onwards. */
export async function listReceived(tenantId: string, closedSince: string): Promise<ReceivedListRow[]> {
  const rows = await db
    .select({ c: receivedCheques, depositBank: accounts.name })
    .from(receivedCheques)
    .leftJoin(accounts, eq(accounts.id, receivedCheques.depositAccountId))
    .where(and(eq(receivedCheques.tenantId, tenantId), sql`(${receivedCheques.status} in ('received', 'deposited') or ${receivedCheques.updatedAt} >= ${closedSince}::date)`))
    .orderBy(asc(receivedCheques.chequeDate), asc(receivedCheques.chequeNumber))
    .limit(1000);
  return rows.map(({ c, depositBank }) => ({
    id: c.id,
    customerId: c.customerId,
    payerName: c.payerName,
    drawerBank: c.drawerBank,
    chequeNumber: c.chequeNumber,
    amount: num(c.amount),
    receivedDate: c.receivedDate,
    chequeDate: c.chequeDate,
    status: c.status as ReceivedStatus,
    depositAccountId: c.depositAccountId,
    depositBank,
    depositedDate: c.depositedDate,
    clearedDate: c.clearedDate,
    paymentId: c.paymentId,
    closedReason: c.closedReason,
    memo: c.memo,
  }));
}

/** What a customer still owes on open invoices, oldest first, for showing what a cheque would settle. */
export async function customerOpenInvoices(tenantId: string, customerId: string): Promise<OpenBill[]> {
  const rows = await db
    .select({ number: salesInvoices.invoiceNumber, date: salesInvoices.invoiceDate, outstanding: sql<string>`(${salesInvoices.total} - ${salesInvoices.amountPaid})` })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.customerId, customerId), inArray(salesInvoices.status, ["sent", "partially_paid", "overdue"]), sql`(${salesInvoices.total} - ${salesInvoices.amountPaid}) > 0`))
    .orderBy(asc(salesInvoices.invoiceDate), asc(salesInvoices.invoiceNumber));
  return rows.map((r) => ({ number: r.number, date: r.date, outstanding: round2(num(r.outstanding)) }));
}

/** Writes a cheque from a customer into the register. Nothing is posted to the ledger: that happens when it clears. */
export async function receiveCheque(tenantId: string, userId: string, input: ReceivedInput, today: string): Promise<{ id: string }> {
  const problem = validateReceived(input, today);
  if (problem) throw new Error(problem);
  const [customer] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId))).limit(1);
  if (!customer) throw new Error("That customer could not be found.");
  try {
    const [row] = await db
      .insert(receivedCheques)
      .values({
        tenantId,
        customerId: input.customerId,
        payerName: customer.name,
        drawerBank: input.drawerBank.trim(),
        chequeNumber: input.chequeNumber.trim(),
        amount: input.amount.toFixed(2),
        receivedDate: input.receivedDate,
        chequeDate: input.chequeDate,
        memo: input.memo?.trim() || null,
        createdBy: userId,
      })
      .returning({ id: receivedCheques.id });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Cheque ${input.chequeNumber.trim()} from ${customer.name} on ${input.drawerBank.trim()} is already in the register.`);
    throw e;
  }
}

async function assertBank(tenantId: string, accountId: string) {
  const bank = (await chequeBankAccounts(tenantId)).find((b) => b.id === accountId);
  if (!bank) throw new Error("Choose one of your bank accounts to deposit into.");
  return bank;
}

/** The cheque has been handed to the bank. Nothing is posted yet: the money counts only when the bank clears it. */
export async function depositReceived(tenantId: string, chequeId: string, accountId: string, depositedDate: string, today: string): Promise<void> {
  const [c] = await db.select().from(receivedCheques).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId))).limit(1);
  if (!c) throw new Error("That cheque could not be found.");
  if (c.status !== "received") throw new Error("Only a cheque you are holding can be deposited.");
  const problem = validateDeposit(depositedDate, c, today);
  if (problem) throw new Error(problem);
  await assertBank(tenantId, accountId);
  const done = await db.update(receivedCheques).set({ status: "deposited", depositAccountId: accountId, depositedDate, updatedAt: new Date() }).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId), eq(receivedCheques.status, "received"))).returning({ id: receivedCheques.id });
  if (done.length === 0) throw new Error("This cheque changed a moment ago. Refresh to see its state.");
}

async function chequeModeId(tenantId: string, bankAccountId: string): Promise<string | null> {
  const [m] = await db
    .select({ id: paymentModes.id })
    .from(paymentModes)
    .innerJoin(paymentModeAccounts, eq(paymentModeAccounts.modeId, paymentModes.id))
    .where(and(eq(paymentModes.tenantId, tenantId), eq(paymentModes.isActive, true), sql`${paymentModes.name} ilike '%cheque%'`, eq(paymentModeAccounts.accountId, bankAccountId)))
    .limit(1);
  return m?.id ?? null;
}

/**
 * The bank has paid the cheque: the receipt is posted through the normal payment engine, dated the day it cleared, and the customer's
 * invoices are settled from the oldest. A cheque still being held clears straight into the account chosen here. If posting fails the
 * cheque goes back to the state it was in and nothing is left behind.
 */
export async function clearReceived(tenantId: string, userId: string, chequeId: string, accountId: string | null, clearedDate: string, today: string): Promise<{ paymentId: string | null }> {
  const [c] = await db.select().from(receivedCheques).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId))).limit(1);
  if (!c) throw new Error("That cheque could not be found.");
  if (c.status !== "received" && c.status !== "deposited") throw new Error("This cheque is not waiting to clear.");
  const bankId = c.depositAccountId ?? accountId;
  if (!bankId) throw new Error("Choose the bank account the cheque was paid into.");
  const problem = validateReceivedClear(clearedDate, c, today);
  if (problem) throw new Error(problem);
  const bank = await assertBank(tenantId, bankId);
  await assertPeriodOpen(tenantId, clearedDate);

  const before = { status: c.status, depositAccountId: c.depositAccountId, depositedDate: c.depositedDate };
  const claimed = await db
    .update(receivedCheques)
    .set({ status: "cleared", clearedDate, depositAccountId: bankId, depositedDate: c.depositedDate ?? clearedDate, updatedAt: new Date() })
    .where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId), eq(receivedCheques.status, c.status)))
    .returning({ id: receivedCheques.id });
  if (claimed.length === 0) throw new Error("This cheque was cleared or closed a moment ago. Refresh to see its state.");

  try {
    const input: CreatePaymentInput = {
      direction: "money_in",
      paymentType: "customer_payment",
      paymentDate: clearedDate,
      partyType: "customer",
      customerId: c.customerId,
      accountId: bankId,
      paymentModeId: await chequeModeId(tenantId, bankId),
      paymentMethod: "cheque",
      chequeNumber: c.chequeNumber,
      chequeDate: c.chequeDate,
      chequeBank: c.drawerBank,
      amount: num(c.amount),
      description: `Cheque ${c.chequeNumber} from ${c.payerName}, paid into ${bank.name}`,
      notes: c.memo,
      confirmDuplicate: true,
    };
    const result = await createPayment(tenantId, userId, await buildNextPaymentNumber(tenantId, "money_in"), input);
    const paymentId = "paymentId" in result ? result.paymentId : null;
    await db.update(receivedCheques).set({ paymentId, updatedAt: new Date() }).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId)));
    return { paymentId };
  } catch (e) {
    await db.update(receivedCheques).set({ status: before.status, clearedDate: null, depositAccountId: before.depositAccountId, depositedDate: before.depositedDate, updatedAt: new Date() }).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId)));
    throw e;
  }
}

/**
 * A cheque held and given back to the customer (returned), or one the bank sent back unpaid (bounced). Nothing was posted for either, so
 * nothing is undone. A cheque that had cleared and was then sent back has its receipt voided, which reopens the invoices it settled.
 */
export async function closeReceived(tenantId: string, userId: string, chequeId: string, how: "bounced" | "returned", reason: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new Error("Give a reason, so the record explains itself later.");
  if (why.length > 300) throw new Error("The reason is too long.");
  const [c] = await db.select().from(receivedCheques).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId))).limit(1);
  if (!c) throw new Error("That cheque could not be found.");

  const allowed = (how === "returned" && c.status === "received") || (how === "bounced" && (c.status === "deposited" || c.status === "cleared"));
  if (!allowed) {
    throw new Error(how === "returned" ? "Only a cheque you are still holding can be given back to the customer." : "Only a cheque that was deposited can come back as bounced.");
  }
  if (c.status === "cleared") {
    if (!c.paymentId) throw new Error("This cleared cheque has no receipt to void.");
    await voidPayment(tenantId, c.paymentId, userId, `Cheque ${c.chequeNumber} returned by the bank: ${why}`);
    await db.update(receivedCheques).set({ status: "bounced", closedReason: why, updatedAt: new Date() }).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId)));
    return;
  }
  const done = await db.update(receivedCheques).set({ status: how, closedReason: why, updatedAt: new Date() }).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, tenantId), eq(receivedCheques.status, c.status))).returning({ id: receivedCheques.id });
  if (done.length === 0) throw new Error("This cheque changed a moment ago. Refresh to see its state.");
}
