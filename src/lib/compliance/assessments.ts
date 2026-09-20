import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceObligations, complianceTaxAssessments } from "@/db/schema";
import { validateADDate } from "@/lib/calendar";
import { logAuditEvent } from "@/lib/audit";
import { postJournalEntry, reverseJournalEntry } from "@/lib/ledger/post";
import { ensureTaxPayableAccount, getOrCreateTaxPenaltyExpenseAccount } from "./tax-accounts";
import { syncObligationFromPayments } from "./tax-amounts";

export type AssessmentInput = {
  taxTypeKey: string;
  kind: "assessment" | "penalty" | "interest";
  amount: number;
  assessmentDate: string;
  description?: string;
  referenceNumber?: string;
  obligationId?: string | null;
  /** Defaults to the "Tax Fines & Penalties" expense account. */
  expenseAccountId?: string | null;
};

const KIND_LABEL = { assessment: "Tax assessment", penalty: "Tax penalty", interest: "Tax interest" } as const;

/**
 * Records a charge from the tax authority and posts it to the ledger through the
 * one posting entry point (so the closed-period check and balanced-entry rules
 * apply):   Dr expense   Cr the tax type's payable account.
 * It raises what is owed for the tax type; settling it is a payment, as usual.
 */
export async function recordTaxAssessment(tenantId: string, userId: string, input: AssessmentInput) {
  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  if (!validateADDate(input.assessmentDate)) throw new Error("Enter the assessment date");

  const payable = await ensureTaxPayableAccount(tenantId, input.taxTypeKey);
  if (!payable) throw new Error("This tax type has no payable account configured");

  let expenseAccountId = input.expenseAccountId ?? null;
  if (expenseAccountId) {
    const [acct] = await db.select().from(accounts).where(and(eq(accounts.id, expenseAccountId), eq(accounts.tenantId, tenantId))).limit(1);
    if (!acct || acct.category !== "expense") throw new Error("Choose an expense account for the charge");
  } else {
    expenseAccountId = (await getOrCreateTaxPenaltyExpenseAccount(tenantId)).id;
  }

  if (input.obligationId) {
    const [ob] = await db
      .select({ id: complianceObligations.id, taxTypeKey: complianceObligations.taxTypeKey })
      .from(complianceObligations)
      .where(and(eq(complianceObligations.id, input.obligationId), eq(complianceObligations.tenantId, tenantId)))
      .limit(1);
    if (!ob) throw new Error("Compliance item not found");
    if (ob.taxTypeKey !== input.taxTypeKey) throw new Error("The charge's tax type does not match the compliance item");
  }

  const label = input.description?.trim() || KIND_LABEL[input.kind];
  const entry = await postJournalEntry({
    tenantId,
    entryDate: input.assessmentDate,
    sourceType: "tax_assessment",
    referenceNumber: input.referenceNumber?.trim() || undefined,
    memo: label,
    createdBy: userId,
    lines: [
      { accountId: expenseAccountId, debitAmount: amount, description: label },
      { accountId: payable.id, creditAmount: amount, description: label },
    ],
  });

  const [row] = await db
    .insert(complianceTaxAssessments)
    .values({
      tenantId,
      obligationId: input.obligationId ?? null,
      taxTypeKey: input.taxTypeKey,
      kind: input.kind,
      assessmentDate: input.assessmentDate,
      amount: amount.toFixed(2),
      description: input.description?.trim() || null,
      referenceNumber: input.referenceNumber?.trim() || null,
      expenseAccountId,
      payableAccountId: payable.id,
      journalEntryId: entry.id,
      createdBy: userId,
    })
    .returning();

  if (input.obligationId) await syncObligationFromPayments(tenantId, input.obligationId);
  await logAuditEvent({ tenantId, userId, action: "tax_assessment_recorded", entityType: "tax_assessment", entityId: row.id, after: { kind: input.kind, taxTypeKey: input.taxTypeKey, amount, date: input.assessmentDate } });
  return row;
}

/** Reverses the ledger entry and marks the charge voided; the record is kept. */
export async function voidTaxAssessment(tenantId: string, userId: string, assessmentId: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required to void a charge");
  const [row] = await db
    .select()
    .from(complianceTaxAssessments)
    .where(and(eq(complianceTaxAssessments.id, assessmentId), eq(complianceTaxAssessments.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new Error("Charge not found");
  if (row.status === "voided") throw new Error("This charge is already voided");

  if (row.journalEntryId) await reverseJournalEntry(tenantId, row.journalEntryId, userId, `Void of tax charge: ${reason.trim()}`);
  await db.update(complianceTaxAssessments).set({ status: "voided", voidReason: reason.trim(), voidedAt: new Date() }).where(eq(complianceTaxAssessments.id, row.id));
  if (row.obligationId) await syncObligationFromPayments(tenantId, row.obligationId);
  await logAuditEvent({ tenantId, userId, action: "tax_assessment_voided", entityType: "tax_assessment", entityId: row.id, before: { status: "posted" }, after: { status: "voided", reason: reason.trim() } });
}
