import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceExceptions, complianceObligations, complianceRequirementTemplates, complianceTaxAssessments, tenantTaxRegistrations } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { loadComplianceTab } from "./compliance-tab";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const templateIds: string[] = [];
const today = "2026-11-07";
const range = { from: "2026-07-17", to: "2027-07-16" };

beforeAll(async () => {
  org = await createTempOrg("ZZ Compliance tab");
  const ob = (name: string, dueDate: string, over: Partial<typeof complianceObligations.$inferInsert> = {}) => ({ tenantId: org.tenantId, name, categoryKey: "tax", periodLabel: "Kartik", dueDate, source: "manual" as const, ...over });
  await db.insert(complianceObligations).values([
    ob("TDS deposit", "2026-10-10", { amountDue: "48200.00" }), // overdue
    ob("VAT return", "2026-11-10"), // due this week
    ob("Annual return", "2026-11-30", { categoryKey: "statutory" }), // coming
    ob("Income tax return", "2026-10-01", { status: "filed", filingDate: "2026-10-03" }), // filed in the period
    ob("Old return", "2025-10-01", { status: "filed", filingDate: "2025-10-03", filedBeforeSystem: true }),
  ]);
  // Items that came from the platform's published templates. One template applies (VAT registered), one has been switched off by the platform.
  const stamp = Date.now();
  const tpl = (key: string, over: Partial<typeof complianceRequirementTemplates.$inferInsert> = {}) => ({ countryCode: "NP", key: `zz_${key}_${stamp}`, name: `ZZ ${key}`, categoryKey: "tax", taxTypeKey: "vat", frequency: "monthly" as const, dueRule: { period: "month", dueDay: 25 }, applicability: { fact: "registered_tax_types", op: "includes", value: "vat" }, isActive: true, ...over });
  const [on] = await db.insert(complianceRequirementTemplates).values(tpl("on")).returning({ id: complianceRequirementTemplates.id });
  const [off] = await db.insert(complianceRequirementTemplates).values(tpl("off", { isActive: false })).returning({ id: complianceRequirementTemplates.id });
  templateIds.push(on.id, off.id);
  await db.insert(complianceObligations).values([
    ob("Published and applies", "2026-11-20", { templateId: on.id, source: "generated", taxTypeKey: "vat" }),
    ob("Platform switched it off", "2026-10-05", { templateId: off.id, source: "generated", taxTypeKey: "vat" }),
    ob("Excise permit without a registration", "2026-10-06", { source: "generated", taxTypeKey: "excise" }),
  ]);

  // a new organization may already have some registrations: set these two exactly (and one for a tax the platform never published)
  for (const r of [{ taxTypeKey: "vat", registrationNumber: "600123456", status: "active" as const }, { taxTypeKey: "pan", registrationNumber: "300111222", status: "suspended" as const }, { taxTypeKey: "ghost_tax", registrationNumber: "1", status: "active" as const }]) {
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, ...r }).onConflictDoUpdate({ target: [tenantTaxRegistrations.tenantId, tenantTaxRegistrations.taxTypeKey], set: { registrationNumber: r.registrationNumber, status: r.status } });
  }
  await db.insert(complianceExceptions).values([
    { tenantId: org.tenantId, exceptionType: "duplicate_invoice", description: "Two invoices look the same", dedupeKey: "t1" },
    { tenantId: org.tenantId, exceptionType: "duplicate_invoice", description: "Resolved one", dedupeKey: "t2", status: "closed" },
  ]);
  const acct = (await db.select().from(accounts).where(eq(accounts.tenantId, org.tenantId)).limit(2));
  const fine = (amount: string, kind: "penalty" | "interest" | "assessment", date: string, status: "posted" | "voided" = "posted") => ({ tenantId: org.tenantId, taxTypeKey: "vat", kind, assessmentDate: date, amount, expenseAccountId: acct[0].id, payableAccountId: acct[1].id, createdBy: org.userId, status });
  await db.insert(complianceTaxAssessments).values([fine("1500.00", "penalty", "2026-10-15"), fine("300.50", "interest", "2026-10-20"), fine("9999.00", "assessment", "2026-10-21"), fine("700.00", "penalty", "2026-10-22", "voided"), fine("800.00", "penalty", "2026-05-01")]);
});
afterAll(async () => {
  await org.remove();
  for (const id of templateIds) await db.delete(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.id, id));
});

describe("what the Compliance tab loads for an organization", () => {
  it("counts the open items, lists them with their amounts, and counts what was filed in the period", async () => {
    const t = await loadComplianceTab(org.tenantId, today, range);
    expect(t.counts).toEqual({ overdue: 1, dueSoon: 1, coming: 2, filedInPeriod: 1 });
    expect(t.deadlines.map((d) => d.name)).toEqual(["TDS deposit", "VAT return", "Published and applies", "Annual return"]);
    expect(t.deadlines[0]).toMatchObject({ status: "overdue", amount: 48200, area: "tax" });
    expect(t.areas.find((a) => a.key === "statutory")).toMatchObject({ pending: 1, overdue: 0 });
  });

  it("shows registrations with their state, open exceptions, and only the fines and interest posted in the period", async () => {
    const t = await loadComplianceTab(org.tenantId, today, range);
    expect(t.registrations.map((r) => [r.key, r.state])).toEqual(expect.arrayContaining([["vat", "active"], ["pan", "suspended"]]));
    expect(t.registrations.some((r) => r.key === "ghost_tax")).toBe(false); // a registration for a tax the platform never published is not shown
    expect(t.openExceptions).toBe(1); // the closed one is not counted
    expect(t.finesInPeriod).toBe(1800.5); // penalty + interest; not the assessment, the voided one or the one before the period
    expect(t.hasAnything).toBe(true);
  });

  it("changing the period changes filed and fines but not what is open", async () => {
    const t = await loadComplianceTab(org.tenantId, today, { from: "2026-05-01", to: "2026-05-31" });
    expect(t.counts).toMatchObject({ overdue: 1, dueSoon: 1, coming: 2, filedInPeriod: 0 });
    expect(t.finesInPeriod).toBe(800);
  });

  it("shows only what the platform published and still applies: not an item from a switched-off template, nor a permit without its registration", async () => {
    const t = await loadComplianceTab(org.tenantId, today, range);
    const names = t.deadlines.map((d) => d.name);
    expect(names).toContain("Published and applies");
    expect(names).not.toContain("Platform switched it off");
    expect(names).not.toContain("Excise permit without a registration");
    expect(t.counts.overdue).toBe(1); // the two hidden items are past due and would otherwise have made it 3
  });

  it("is empty for an organization with nothing set up", async () => {
    const other = await createTempOrg("ZZ Compliance tab empty");
    try {
      const t = await loadComplianceTab(other.tenantId, today, range);
      expect(t).toMatchObject({ counts: { overdue: 0, dueSoon: 0, coming: 0, filedInPeriod: 0 }, deadlines: [], hasAnything: false, openExceptions: 0, finesInPeriod: 0 });
    } finally {
      await other.remove();
    }
  });
});
