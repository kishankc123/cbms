"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { createPayment } from "@/lib/ledger/payments-engine";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { logAuditEvent } from "@/lib/audit";
import { FUNDS, retirementBalances, type FundKey } from "@/lib/payroll/contributions";
import type { RetirementAccountKey } from "@/lib/payroll/retirement-pay";

const round2 = (n: number) => Math.round(n * 100) / 100;

// What payroll still owes the retirement funds, and what has been paid. Amounts are salary figures, so they need the same permission as the salary sheet.
export async function getContributions() {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "view") || !can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  const balances = await retirementBalances(session.tenantId);
  const recent = await db
    .select({ id: payments.id, number: payments.paymentNumber, date: payments.paymentDate, amount: payments.amount, status: payments.status, payee: payments.partyOtherName, description: payments.description })
    .from(payments)
    .where(and(eq(payments.tenantId, session.tenantId), eq(payments.paymentType, "retirement_payment")))
    .orderBy(desc(payments.paymentDate), desc(payments.paymentNumber))
    .limit(20);
  return {
    funds: FUNDS.map((f) => ({ key: f.key, name: f.name, accounts: f.accounts.map((a) => ({ key: a, owed: balances[a].owed })) })),
    recent,
  };
}
export type ContributionsData = Awaited<ReturnType<typeof getContributions>>;

export type PayContributionsInput = {
  fund: FundKey;
  /** What is paid out of each of the fund's payable accounts. */
  parts: { account: RetirementAccountKey; amount: number }[];
  paymentDate: string;
  accountId: string;
  paymentModeId?: string | null;
  paymentMethod: "cash" | "bank_transfer" | "cheque" | "card" | "online" | "other";
  referenceNumber: string;
  chequeNumber?: string;
  notes?: string;
  confirmDuplicate?: boolean;
};

/** Pays a fund (SSF, PF or CIT) what payroll owes it, through the ordinary Payments engine: a real payment with a number, bank reconciliation, period lock and audit. */
export async function payContributions(input: PayContributionsInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit") || !can(session, "payroll", "view_salary") || !can(session, "payments", "create")) throw new Error("Not permitted");
  const fund = FUNDS.find((f) => f.key === input.fund);
  if (!fund) throw new Error("Choose a fund to pay");
  const parts = input.parts.filter((p) => p.amount > 0);
  if (parts.some((p) => !(fund.accounts as RetirementAccountKey[]).includes(p.account))) throw new Error("That account does not belong to this fund");
  const amount = round2(parts.reduce((s, p) => s + p.amount, 0));
  if (!(amount > 0)) throw new Error("Enter how much you are paying");

  const number = await buildNextPaymentNumber(session.tenantId, "money_out");
  const result = await createPayment(session.tenantId, session.userId, number, {
    direction: "money_out",
    paymentType: "retirement_payment",
    paymentDate: input.paymentDate,
    partyType: "other",
    partyOtherName: fund.name,
    accountId: input.accountId,
    paymentModeId: input.paymentModeId,
    paymentMethod: input.paymentMethod,
    chequeNumber: input.chequeNumber || null,
    referenceNumber: input.referenceNumber.trim() || null,
    amount,
    description: `${fund.name} contributions`,
    notes: input.notes?.trim() || null,
    retirementSplit: parts,
    confirmDuplicate: input.confirmDuplicate,
  });
  // A near-identical payment was just recorded: nothing was posted; ask the person to confirm.
  if ("duplicateWarning" in result) return { duplicateWarning: true as const };

  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "retirement_payment_recorded", entityType: "payment", entityId: result.paymentId, after: { fund: input.fund, paymentNumber: result.paymentNumber, amount, parts, date: input.paymentDate } });
  for (const p of ["/payroll/contributions", "/payments", "/dashboard", "/journal"]) revalidatePath(p, "layout");
  return { duplicateWarning: false as const, paymentNumber: result.paymentNumber };
}
