"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceObligations, complianceTaxAssessments, complianceTaxTypes, paymentAllocations, payments, tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { validateADDate, todayIso } from "@/lib/calendar";
import { logAuditEvent } from "@/lib/audit";
import { listOrgUsers } from "@/lib/org-users";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { buildNextPaymentNumber } from "@/lib/payment-number";
import { createPayment } from "@/lib/ledger/payments-engine";
import { recordTaxAssessment, voidTaxAssessment } from "@/lib/compliance/assessments";
import { obligationAmounts, syncObligationFromPayments } from "@/lib/compliance/tax-amounts";
import { effectiveStatus, type ObligationStatus } from "@/lib/compliance/engine/status";
import { generateObligations } from "@/lib/compliance/engine/generate";

async function taxTypeNames(tenantId: string) {
  const [t] = await db.select({ countryCode: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const rows = await db.select().from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, t?.countryCode ?? ""));
  return { byKey: new Map(rows.map((r) => [r.key, r])), all: rows };
}

// ---------------------------------------------------------------- list

export async function listTaxCompliance() {
  const session = await requireTenantSession();
  const today = todayIso();
  try {
    await generateObligations(session.tenantId);
  } catch (e) {
    console.error("compliance generation failed", e);
  }

  const rows = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.tenantId, session.tenantId), eq(complianceObligations.categoryKey, "tax")))
    .orderBy(asc(complianceObligations.dueDate));
  const amounts = await obligationAmounts(session.tenantId, rows);
  const { byKey, all } = await taxTypeNames(session.tenantId);
  const users = await listOrgUsers(session.tenantId);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  return {
    today,
    canEdit: can(session, "compliance", "edit"),
    taxTypes: all.filter((t) => rows.some((r) => r.taxTypeKey === t.key)).map((t) => ({ key: t.key, name: t.name })),
    items: rows.map((r) => {
      const a = amounts.get(r.id)!;
      return {
        id: r.id,
        name: r.name,
        taxTypeKey: r.taxTypeKey ?? "",
        taxTypeName: r.taxTypeKey ? byKey.get(r.taxTypeKey)?.name ?? r.taxTypeKey : "",
        period: r.periodLabel,
        dueDate: r.dueDate,
        filingDate: r.filingDate,
        paymentDueDate: r.paymentDueDate,
        paymentDate: r.paymentDate,
        status: r.status as ObligationStatus,
        effective: effectiveStatus(r, today),
        amountDue: a.due,
        amountPaid: a.paid,
        balance: a.balance,
        responsible: r.responsibleUserId ? userName.get(r.responsibleUserId) ?? "—" : "—",
      };
    }),
  };
}

// ---------------------------------------------------------------- detail

export async function getTaxObligationDetail(id: string) {
  const session = await requireTenantSession();
  const [ob] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, id), eq(complianceObligations.tenantId, session.tenantId)))
    .limit(1);
  if (!ob) throw new Error("Compliance item not found");
  const a = (await obligationAmounts(session.tenantId, [ob])).get(ob.id)!;
  const { byKey } = await taxTypeNames(session.tenantId);

  const charges = await db
    .select()
    .from(complianceTaxAssessments)
    .where(and(eq(complianceTaxAssessments.tenantId, session.tenantId), eq(complianceTaxAssessments.obligationId, ob.id)))
    .orderBy(desc(complianceTaxAssessments.assessmentDate));

  const paid = await db
    .select({
      paymentId: payments.id,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      status: payments.status,
      referenceNumber: payments.referenceNumber,
      allocated: paymentAllocations.allocatedAmount,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(eq(payments.tenantId, session.tenantId), eq(paymentAllocations.targetType, "tax_obligation"), eq(paymentAllocations.targetId, ob.id)))
    .orderBy(desc(payments.paymentDate));

  const users = await listOrgUsers(session.tenantId);
  return {
    canEdit: can(session, "compliance", "edit"),
    canPay: can(session, "compliance", "edit") && can(session, "payments", "create"),
    users,
    item: {
      id: ob.id,
      name: ob.name,
      taxTypeKey: ob.taxTypeKey ?? "",
      taxTypeName: ob.taxTypeKey ? byKey.get(ob.taxTypeKey)?.name ?? ob.taxTypeKey : "",
      hasPayableAccount: Boolean(ob.taxTypeKey && byKey.get(ob.taxTypeKey)?.payableAccountName),
      period: ob.periodLabel,
      dueDate: ob.dueDate,
      status: ob.status as ObligationStatus,
      effective: effectiveStatus(ob, todayIso()),
      notApplicableReason: ob.notApplicableReason,
      filingDate: ob.filingDate ?? "",
      paymentDueDate: ob.paymentDueDate ?? "",
      paymentDate: ob.paymentDate ?? "",
      filingReference: ob.filingReference ?? "",
      paymentReference: ob.paymentReference ?? "",
      supportingDocument: ob.supportingDocument ?? "",
      notes: ob.notes ?? "",
      responsibleUserId: ob.responsibleUserId ?? "",
      enteredAmount: ob.amountDue ?? "",
    },
    amounts: a,
    charges: charges.map((c) => ({ id: c.id, kind: c.kind, date: c.assessmentDate, amount: Number(c.amount), description: c.description ?? "", reference: c.referenceNumber ?? "", status: c.status })),
    payments: paid.map((p) => ({ paymentId: p.paymentId, number: p.paymentNumber, date: p.paymentDate, reference: p.referenceNumber ?? "", amount: Number(p.allocated), voided: p.status === "voided" })),
  };
}

/** Choices for the payment and charge forms. */
export async function getTaxActionOptions() {
  const session = await requireTenantSession();
  const groups = await getCashBankAccounts(session.tenantId);
  // A group with sub-accounts (e.g. Bank) is a heading; its children are what can be paid from.
  const cashBank = groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }]));
  const expense = await db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.tenantId, session.tenantId), eq(accounts.category, "expense"), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.code));
  return { cashBank, expense };
}

// ---------------------------------------------------------------- changes

export type ObligationPatch = {
  filingDate: string;
  paymentDueDate: string;
  filingReference: string;
  paymentReference: string;
  supportingDocument: string;
  notes: string;
  responsibleUserId: string;
  /** Only honoured when the tax type has no calculation of its own. */
  enteredAmount?: string;
};

export async function updateTaxObligation(id: string, patch: ObligationPatch) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) throw new Error("Not permitted");
  for (const v of [patch.filingDate, patch.paymentDueDate]) if (v && !validateADDate(v)) throw new Error("Enter valid dates");

  const [before] = await db
    .select()
    .from(complianceObligations)
    .where(and(eq(complianceObligations.id, id), eq(complianceObligations.tenantId, session.tenantId)))
    .limit(1);
  if (!before) throw new Error("Compliance item not found");

  const amounts = (await obligationAmounts(session.tenantId, [before])).get(before.id)!;
  const entered = patch.enteredAmount?.trim();
  const enteredValue = amounts.computedDue === null && entered ? Number(entered) : null;
  if (enteredValue !== null && (!Number.isFinite(enteredValue) || enteredValue < 0)) throw new Error("Enter a valid amount");

  const next = {
    filingDate: patch.filingDate || null,
    paymentDueDate: patch.paymentDueDate || null,
    filingReference: patch.filingReference.trim() || null,
    paymentReference: patch.paymentReference.trim() || null,
    supportingDocument: patch.supportingDocument.trim() || null,
    notes: patch.notes.trim() || null,
    responsibleUserId: patch.responsibleUserId || null,
    ...(amounts.computedDue === null && patch.enteredAmount !== undefined ? { amountDue: enteredValue !== null ? enteredValue.toFixed(2) : null } : {}),
    updatedAt: new Date(),
  };
  await db.update(complianceObligations).set(next).where(eq(complianceObligations.id, before.id));
  await syncObligationFromPayments(session.tenantId, before.id);

  await logAuditEvent({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "compliance_item_updated",
    entityType: "compliance_obligation",
    entityId: before.id,
    before: { filingDate: before.filingDate, paymentDueDate: before.paymentDueDate, filingReference: before.filingReference, paymentReference: before.paymentReference, amountDue: before.amountDue },
    after: { filingDate: next.filingDate, paymentDueDate: next.paymentDueDate, filingReference: next.filingReference, paymentReference: next.paymentReference, ...("amountDue" in next ? { amountDue: next.amountDue } : {}) },
  });
  revalidatePath("/compliance", "layout");
}

export type ObligationPaymentInput = {
  obligationId: string;
  amount: number;
  paymentDate: string;
  accountId: string;
  paymentMethod: "cash" | "bank_transfer" | "cheque" | "card" | "online" | "other";
  referenceNumber: string;
  chequeNumber?: string;
  confirmDuplicate?: boolean;
};

/**
 * Pays a tax compliance item through the ordinary Payments engine, so it is a real
 * payment (Payments list, bank reconciliation, period locking, audit) that is
 * allocated to the item — and the item's paid amount and status follow from it.
 */
export async function recordObligationPayment(input: ObligationPaymentInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit") || !can(session, "payments", "create")) throw new Error("Not permitted");
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");

  const number = await buildNextPaymentNumber(session.tenantId, "money_out");
  const result = await createPayment(session.tenantId, session.userId, number, {
    direction: "money_out",
    paymentType: "tax_payment",
    paymentDate: input.paymentDate,
    partyType: "none",
    accountId: input.accountId,
    paymentMethod: input.paymentMethod,
    chequeNumber: input.chequeNumber || null,
    referenceNumber: input.referenceNumber.trim() || null,
    amount: input.amount,
    description: "Tax payment",
    allocations: [{ targetType: "tax_obligation", targetId: input.obligationId, allocatedAmount: input.amount }],
    confirmDuplicate: input.confirmDuplicate,
  });
  // A near-identical payment was just recorded: nothing was posted; ask the user to confirm.
  if ("duplicateWarning" in result) return { duplicateWarning: true as const };

  await logAuditEvent({ tenantId: session.tenantId, userId: session.userId, action: "tax_payment_recorded", entityType: "compliance_obligation", entityId: input.obligationId, after: { paymentNumber: result.paymentNumber, amount: input.amount, date: input.paymentDate } });
  for (const p of ["/compliance", "/payments", "/dashboard", "/journal"]) revalidatePath(p, "layout");
  return { duplicateWarning: false as const, paymentNumber: result.paymentNumber };
}

export type TaxChargeInput = {
  obligationId: string;
  taxTypeKey: string;
  kind: "assessment" | "penalty" | "interest";
  amount: number;
  date: string;
  description: string;
  reference: string;
  expenseAccountId: string;
};

export async function recordTaxCharge(input: TaxChargeInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  await recordTaxAssessment(session.tenantId, session.userId, {
    taxTypeKey: input.taxTypeKey,
    kind: input.kind,
    amount: input.amount,
    assessmentDate: input.date,
    description: input.description,
    referenceNumber: input.reference,
    obligationId: input.obligationId || null,
    expenseAccountId: input.expenseAccountId || null,
  });
  for (const p of ["/compliance", "/dashboard", "/journal"]) revalidatePath(p, "layout");
}

export async function voidTaxCharge(assessmentId: string, reason: string) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "delete")) throw new Error("Not permitted");
  await voidTaxAssessment(session.tenantId, session.userId, assessmentId, reason);
  for (const p of ["/compliance", "/dashboard", "/journal"]) revalidatePath(p, "layout");
}
