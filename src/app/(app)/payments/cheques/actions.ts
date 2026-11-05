"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { issuedCheques, vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { chequeBankAccounts, clearCheque, closeCheque, issueCheque, nextNumberFor, settlementPreview, supplierOpenBills, unpaidExpenses, type ChequeInput } from "@/lib/cheques/cheques";
import { loadForecast } from "@/lib/dashboard/forecast";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

function refresh() {
  for (const path of ["/payments", "/payments/cheques", "/payments/money-out", "/dashboard", "/journal", "/suppliers", "/purchases/stockable", "/expenses"]) revalidatePath(path);
}

/** What the Issue cheque form needs: the banks to draw on, suppliers, and expenses a cheque can pay. */
export async function getChequeFormData() {
  const session = await requireTenantSession();
  if (!can(session, "payments", "view")) throw new Error("Not permitted");
  const [banks, supplierList, expenseList] = await Promise.all([
    chequeBankAccounts(session.tenantId),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    unpaidExpenses(session.tenantId),
  ]);
  const firstNumber = banks[0] ? await nextNumberFor(session.tenantId, banks[0].id) : "";
  return { banks, vendors: supplierList, expenses: expenseList, firstNumber };
}

export async function getNextChequeNumber(bankAccountId: string): Promise<string> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "view")) throw new Error("Not permitted");
  return nextNumberFor(session.tenantId, bankAccountId);
}

/** A supplier's open bills and what a cheque of this amount would settle (oldest first), shown before the cheque is written. */
export async function getSupplierPreview(vendorId: string, amount: number) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "view")) throw new Error("Not permitted");
  const bills = await supplierOpenBills(session.tenantId, vendorId);
  return { owed: Math.round(bills.reduce((s, b) => s + b.outstanding, 0) * 100) / 100, ...settlementPreview(bills, Number.isFinite(amount) ? amount : 0) };
}

/**
 * The cash forecast for the next 180 days with the cheque being written already in it (not saved), so the form can show what the cheque
 * does to cash on its date. The forecast already counts every cheque in the register and leaves out the bills they cover.
 */
export async function getFundingOutlook(draft: { payeeKind: "supplier" | "expense"; vendorId: string | null; expenseId: string | null; amount: number; chequeDate: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payments", "view")) throw new Error("Not permitted");
  const amount = Number.isFinite(draft.amount) && draft.amount > 0 ? draft.amount : 0;
  const extra = amount > 0 ? [{ id: "draft", chequeNumber: "new", payeeKind: draft.payeeKind, vendorId: draft.vendorId, expenseId: draft.expenseId, payeeName: "This cheque", amount, chequeDate: draft.chequeDate }] : [];
  const r = await loadForecast(session.tenantId, todayIso(), 180, { extraCheques: extra });
  return { openingCash: r.forecast.openingCash, days: r.forecast.days, reserve: r.forecast.reserve };
}

export async function issueChequeAction(input: ChequeInput): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) return { ok: false, error: "You do not have permission to issue cheques." };
  try {
    await issueCheque(session.tenantId, session.userId, input, todayIso());
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function clearChequeAction(chequeId: string, clearedDate: string): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "create")) return { ok: false, error: "You do not have permission to record a cheque clearing." };
  try {
    await clearCheque(session.tenantId, session.userId, chequeId, clearedDate, todayIso());
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Stopping or bouncing a cheque that never cleared needs Edit; a cheque the bank paid and later returned also voids a payment, which needs Void. */
export async function closeChequeAction(chequeId: string, how: "stopped" | "bounced", reason: string): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "payments", "edit")) return { ok: false, error: "You do not have permission to change cheques." };
  try {
    const [c] = await db.select({ status: issuedCheques.status }).from(issuedCheques).where(and(eq(issuedCheques.id, chequeId), eq(issuedCheques.tenantId, session.tenantId))).limit(1);
    if (c?.status === "cleared" && !can(session, "payments", "void")) return { ok: false, error: "You do not have permission to void the payment this cheque made." };
    await closeCheque(session.tenantId, session.userId, chequeId, how, reasonOf(reason));
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

const reasonOf = (r: unknown) => (typeof r === "string" ? r : "");
