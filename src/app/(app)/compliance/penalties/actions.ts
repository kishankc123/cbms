"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceTaxTypes, tenants } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { validateADDate, type CalendarSystem, type IsoDate } from "@/lib/calendar";
import { recordTaxAssessment } from "@/lib/compliance/assessments";
import { getPenaltyRule } from "@/lib/compliance/penalty-rules";
import type { TaxTypeKey } from "@/lib/compliance/penalty-engine";

const PENALTY_TAX_TYPES: TaxTypeKey[] = ["vat", "tds", "excise"];

/** The tenant's country/calendar and which of VAT/TDS/Excise it can calculate penalties for. */
export async function getPenaltyCalculatorContext() {
  const session = await requireTenantSession();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");
  const calendar: CalendarSystem = tenant.calendarSystem === "BS" ? "BS" : "AD";

  const types = await db.select().from(complianceTaxTypes).where(eq(complianceTaxTypes.countryCode, tenant.countryCode));
  const byKey = new Map(types.map((t) => [t.key, t]));

  return {
    canRecord: can(session, "compliance", "create"),
    calendar,
    taxTypes: PENALTY_TAX_TYPES.filter((k) => byKey.has(k)).map((k) => ({ key: k, name: byKey.get(k)!.name })),
  };
}

/** The penalty rule parameters in force for this tax type on the given due date, plus their verification status. */
export async function getPenaltyRuleForPreview(taxTypeKey: TaxTypeKey, dueDate: IsoDate) {
  const session = await requireTenantSession();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) throw new Error("Organization not found");
  if (!validateADDate(dueDate)) throw new Error("Invalid due date");
  const rule = await getPenaltyRule(tenant.countryCode, taxTypeKey, dueDate);
  if (!rule) return null;
  return { params: rule.params, isVerified: rule.isVerified, source: rule.source };
}

export type RecordPenaltyInput = {
  taxTypeKey: TaxTypeKey;
  periodLabel: string;
  dueDate: IsoDate;
  actualDate: IsoDate;
  penaltyAmount: number;
  interestAmount: number;
};

/**
 * Posts the calculated filing/payment penalty and the interest as separate charges against the tax type, through
 * the same posting entry point every other tax charge uses (Dr expense / Cr the tax type's payable account).
 */
export async function recordPenaltyCharge(input: RecordPenaltyInput) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "create")) throw new Error("Not permitted");
  if (!validateADDate(input.dueDate) || !validateADDate(input.actualDate)) throw new Error("Invalid dates");

  const description = `${input.periodLabel} — due ${input.dueDate}, filed/paid ${input.actualDate}`;
  if (input.penaltyAmount > 0) {
    await recordTaxAssessment(session.tenantId, session.userId, {
      taxTypeKey: input.taxTypeKey,
      kind: "penalty",
      amount: input.penaltyAmount,
      assessmentDate: input.actualDate,
      description: `Late filing/payment penalty — ${description}`,
    });
  }
  if (input.interestAmount > 0) {
    await recordTaxAssessment(session.tenantId, session.userId, {
      taxTypeKey: input.taxTypeKey,
      kind: "interest",
      amount: input.interestAmount,
      assessmentDate: input.actualDate,
      description: `Interest on overdue tax — ${description}`,
    });
  }
  for (const p of ["/compliance", "/compliance/penalties", "/dashboard", "/journal"]) revalidatePath(p, "layout");
}
