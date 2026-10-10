import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, complianceObligations, complianceRequirementTemplates, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { listTemplates, updateTemplate, type UpdateTemplateInput } from "./template-admin";

// A throwaway country and template, so the real requirements are never touched.
const CODE = "ZU";
let org: Awaited<ReturnType<typeof createTempOrg>>;
let templateId: string;
let openId: string;
let filedId: string;

const input = (over: Partial<UpdateTemplateInput> = {}): UpdateTemplateInput => ({
  id: templateId,
  name: "Test return",
  description: "",
  isActive: true,
  isVerified: false,
  activeFrom: "",
  activeTo: "",
  dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 },
  applicabilityText: "",
  moveOpenItems: false,
  ...over,
});
const obligation = async (id: string) => (await db.select().from(complianceObligations).where(eq(complianceObligations.id, id)))[0];

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Template test country", currency: "ZZZ", statutoryCalendar: "AD" }).onConflictDoNothing();
  [{ id: templateId }] = await db
    .insert(complianceRequirementTemplates)
    .values({ countryCode: CODE, categoryKey: "tax", key: "test_return", name: "Test return", frequency: "monthly", dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 25 }, isActive: true })
    .returning({ id: complianceRequirementTemplates.id });
  org = await createTempOrg("ZZ Template Test");
  await db.update(tenants).set({ countryCode: CODE, calendarSystem: "AD" }).where(eq(tenants.id, org.tenantId));
  const base = { tenantId: org.tenantId, templateId, source: "generated" as const, name: "Test return", categoryKey: "tax", frequency: "monthly" as const };
  [{ id: openId }] = await db
    .insert(complianceObligations)
    .values({ ...base, periodKey: "M:AD:2026-08", periodLabel: "August 2026", periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-09-25", paymentDueDate: "2026-09-25", status: "pending" })
    .returning({ id: complianceObligations.id });
  [{ id: filedId }] = await db
    .insert(complianceObligations)
    .values({ ...base, periodKey: "M:AD:2026-07", periodLabel: "July 2026", periodStart: "2026-07-01", periodEnd: "2026-07-31", dueDate: "2026-08-25", paymentDueDate: "2026-08-25", status: "filed" })
    .returning({ id: complianceObligations.id });
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "compliance_requirement"), like(auditLog.entityId, CODE + ":%")));
  await org.remove();
  await db.delete(complianceRequirementTemplates).where(eq(complianceRequirementTemplates.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("managing requirement templates", () => {
  it("lists a country's templates in plain language, with how many items came from each", async () => {
    const [t] = await listTemplates(CODE);
    expect(t).toMatchObject({ key: "test_return", categoryName: "Tax", dueRuleText: "The 25th of the following month", applicabilityText: "Every organization", isActive: true, isVerified: false, generatedItems: 2 });
  });

  it("changes the name, verification and conditions, and writes what changed to the platform audit log", async () => {
    const r = await updateTemplate(org.userId, input({ name: "Monthly test return", isVerified: true, description: "Due each month", applicabilityText: '{"fact":"has_employees","op":"eq","value":true}' }));
    expect(r).toMatchObject({ ok: true, movedItems: 0 });
    if (r.ok) expect(r.changes.map((c) => c.field).sort()).toEqual(["Applies to", "Description", "Name", "Verified"]);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "compliance_requirement"), eq(auditLog.entityId, CODE + ":test_return")));
    expect(log).toMatchObject({ action: "compliance_requirement_updated", tenantId: null, userId: org.userId });
    expect(log.beforeValue).toMatchObject({ Name: "Test return", Verified: "No", "Applies to": "Every organization" });
    expect(log.afterValue).toMatchObject({ Name: "Monthly test return", Verified: "Yes", "Applies to": "has employees is true" });
    const [t] = await listTemplates(CODE);
    expect(t).toMatchObject({ name: "Monthly test return", isVerified: true, applicabilityText: "has employees is true" });
  });

  it("does nothing, and logs nothing, when nothing changed", async () => {
    const same = input({ name: "Monthly test return", isVerified: true, description: "Due each month", applicabilityText: '{"fact":"has_employees","op":"eq","value":true}' });
    expect(await updateTemplate(org.userId, same)).toEqual({ ok: true, changes: [], movedItems: 0 });
    expect((await db.select().from(auditLog).where(and(eq(auditLog.entityType, "compliance_requirement"), eq(auditLog.entityId, CODE + ":test_return")))).length).toBe(1);
  });

  it("refuses what cannot work, leaving the template as it was", async () => {
    expect(await updateTemplate(org.userId, input({ name: "  " }))).toMatchObject({ ok: false, error: expect.stringMatching(/name/) });
    expect(await updateTemplate(org.userId, input({ activeFrom: "2026-13-45" }))).toMatchObject({ ok: false });
    expect(await updateTemplate(org.userId, input({ activeFrom: "2026-05-01", activeTo: "2026-04-01" }))).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be before/) });
    expect(await updateTemplate(org.userId, input({ dueRule: null }))).toMatchObject({ ok: false, error: expect.stringMatching(/due date rule/) });
    expect(await updateTemplate(org.userId, input({ applicabilityText: "not json" }))).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(await updateTemplate(org.userId, input({ applicabilityText: '{"fact":"x","op":"like","value":1}' }))).toMatchObject({ ok: false });
    expect(await updateTemplate(org.userId, { ...input(), id: "00000000-0000-0000-0000-000000000000" })).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect((await listTemplates(CODE))[0].name).toBe("Monthly test return");
  });

  it("a new due date rule leaves items already generated alone unless asked", async () => {
    const r = await updateTemplate(org.userId, input({ name: "Monthly test return", isVerified: true, description: "Due each month", dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 10 } }));
    expect(r).toMatchObject({ ok: true, movedItems: 0 });
    expect((await obligation(openId)).dueDate).toBe("2026-09-25");
  });

  it("when asked, moves the items nobody has acted on, but never a filed one", async () => {
    const r = await updateTemplate(org.userId, input({ name: "Monthly test return", isVerified: true, description: "Due each month", dueRule: { period: "month", monthsAfterEnd: 1, dayOfMonth: 12 }, moveOpenItems: true }));
    expect(r).toMatchObject({ ok: true, movedItems: 1 });
    const open = await obligation(openId);
    expect(open.dueDate).toBe("2026-09-12");
    expect(open.paymentDueDate).toBe("2026-09-12"); // it followed the due date
    const filed = await obligation(filedId);
    expect(filed.dueDate).toBe("2026-08-25");
    expect(filed.paymentDueDate).toBe("2026-08-25");
  });
});
