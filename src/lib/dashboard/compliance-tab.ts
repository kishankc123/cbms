import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceExceptions, complianceObligations, complianceTaxAssessments, complianceTaxTypes, tenants, tenantTaxRegistrations } from "@/db/schema";
import { loadPermit } from "@/lib/compliance/excise-permit";
import { onlyStillObligated } from "@/lib/compliance/obligated";
import { buildComplianceTab, type ComplianceTab } from "./compliance-tab-rules";

export type RegistrationView = { key: string; name: string; number: string | null; state: "active" | "inactive" | "suspended" | "deregistered" | "renewal_due" | "expired" };

export type ComplianceTabData = ComplianceTab & {
  registrations: RegistrationView[];
  openExceptions: number;
  /** Penalties and interest charged by the tax authority, in the dashboard's period. */
  finesInPeriod: number;
  hasAnything: boolean;
};

/** Everything the dashboard's Compliance tab shows, for one organization. The open counts ignore the period; "filed" and "fines" use it. */
export async function loadComplianceTab(tenantId: string, today: string, range: { from: string; to: string }): Promise<ComplianceTabData> {
  const [tenant] = await db.select({ country: tenants.countryCode }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [rows, regs, exceptions, fines, permit] = await Promise.all([
    db
      .select({ id: complianceObligations.id, templateId: complianceObligations.templateId, source: complianceObligations.source, taxTypeKey: complianceObligations.taxTypeKey, name: complianceObligations.name, categoryKey: complianceObligations.categoryKey, periodLabel: complianceObligations.periodLabel, dueDate: complianceObligations.dueDate, status: complianceObligations.status, amountDue: complianceObligations.amountDue, filingDate: complianceObligations.filingDate, paymentDate: complianceObligations.paymentDate, filedBeforeSystem: complianceObligations.filedBeforeSystem })
      .from(complianceObligations)
      .where(eq(complianceObligations.tenantId, tenantId))
      .orderBy(asc(complianceObligations.dueDate)),
    db.select().from(tenantTaxRegistrations).where(eq(tenantTaxRegistrations.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)::int` }).from(complianceExceptions).where(and(eq(complianceExceptions.tenantId, tenantId), ne(complianceExceptions.status, "closed"))),
    db
      .select({ total: sql<string>`coalesce(sum(${complianceTaxAssessments.amount}), 0)` })
      .from(complianceTaxAssessments)
      .where(and(eq(complianceTaxAssessments.tenantId, tenantId), eq(complianceTaxAssessments.status, "posted"), inArray(complianceTaxAssessments.kind, ["penalty", "interest"]), gte(complianceTaxAssessments.assessmentDate, range.from), lte(complianceTaxAssessments.assessmentDate, range.to))),
    loadPermit(tenantId, today),
  ]);
  // The platform's published taxes and permits that an organization can register for (the same list the Registrations screen offers).
  const types = tenant ? await db.select({ key: complianceTaxTypes.key, name: complianceTaxTypes.name }).from(complianceTaxTypes).where(and(eq(complianceTaxTypes.countryCode, tenant.country), eq(complianceTaxTypes.isRegistrable, true), eq(complianceTaxTypes.isActive, true))) : [];
  const typeName = new Map(types.map((t) => [t.key, t.name]));

  // Only items the organization is still obliged to: still published by the platform, and still applying to it.
  const obligated = await onlyStillObligated(tenantId, rows, today);
  const tab = buildComplianceTab(obligated.map((r) => ({ ...r, amountDue: r.amountDue === null ? null : Number(r.amountDue) })), today, range);
  const registrations = regs
    .filter((r) => typeName.has(r.taxTypeKey))
    .map((r): RegistrationView => {
      // An excise permit also has to be renewed each year: say so beside the registration.
      const renewal = r.taxTypeKey === "excise" && permit && permit.status.state !== "active" ? (permit.status.state === "expired" ? "expired" : "renewal_due") : null;
      return { key: r.taxTypeKey, name: typeName.get(r.taxTypeKey) as string, number: r.registrationNumber, state: renewal ?? r.status };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...tab,
    registrations,
    openExceptions: exceptions[0]?.n ?? 0,
    finesInPeriod: Math.round(Number(fines[0]?.total ?? 0) * 100) / 100,
    hasAnything: obligated.length > 0,
  };
}
