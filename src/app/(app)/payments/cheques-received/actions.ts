"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, receivedCheques } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { chequeBankAccounts, settlementPreview } from "@/lib/cheques/cheques";
import { clearReceived, closeReceived, customerOpenInvoices, depositReceived, receiveCheque, type ReceivedInput } from "@/lib/cheques/received";

type Result = { ok: true } | { ok: false; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

function refresh() {
  for (const path of ["/payments", "/payments/cheques-received", "/payments/money-in", "/dashboard", "/journal", "/customers", "/sales"]) revalidatePath(path);
}

/** What the Receive cheque form needs: customers, and the bank accounts a cheque can be deposited into. */
export async function getReceivedFormData() {
  const session = await requireTenantSession();
  if (!can(session, "payments", "view")) throw new Error("Not permitted");
  const [customerList, banks] = await Promise.all([db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)), chequeBankAccounts(session.tenantId)]);
  return { customers: customerList, banks };
}

/** A customer's open invoices and what a cheque of this amount would settle (oldest first), shown before the cheque is recorded. */
export async function getCustomerPreview(customerId: string, amount: number) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "view")) throw new Error("Not permitted");
  const invoices = await customerOpenInvoices(session.tenantId, customerId);
  return { owed: Math.round(invoices.reduce((s, b) => s + b.outstanding, 0) * 100) / 100, ...settlementPreview(invoices, Number.isFinite(amount) ? amount : 0) };
}

export async function receiveChequeAction(input: ReceivedInput): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) return { ok: false, error: "You do not have permission to record cheques." };
  try {
    await receiveCheque(session.tenantId, session.userId, input, todayIso());
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function depositChequeAction(chequeId: string, accountId: string, depositedDate: string): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) return { ok: false, error: "You do not have permission to record cheques." };
  try {
    await depositReceived(session.tenantId, chequeId, accountId, depositedDate, todayIso());
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function clearReceivedAction(chequeId: string, accountId: string | null, clearedDate: string): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) return { ok: false, error: "You do not have permission to record a cheque clearing." };
  try {
    await clearReceived(session.tenantId, session.userId, chequeId, accountId, clearedDate, todayIso());
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Giving a held cheque back, or marking a deposited one bounced, needs Edit; a cheque the bank paid and later sent back also voids a receipt, which needs Void. */
export async function closeReceivedAction(chequeId: string, how: "bounced" | "returned", reason: string): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "edit")) return { ok: false, error: "You do not have permission to change cheques." };
  try {
    const [c] = await db.select({ status: receivedCheques.status }).from(receivedCheques).where(and(eq(receivedCheques.id, chequeId), eq(receivedCheques.tenantId, session.tenantId))).limit(1);
    if (c?.status === "cleared" && !can(session, "payments", "void")) return { ok: false, error: "You do not have permission to void the receipt this cheque made." };
    await closeReceived(session.tenantId, session.userId, chequeId, how, typeof reason === "string" ? reason : "");
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
