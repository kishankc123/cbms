import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, complianceCountries, complianceTaxHeads, platformSlabDrafts, platformSlabVersions } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { confirmSlabDraft, ensureSlabCarryForward, listSlabDrafts, listSlabVersions, publishSlabVersion, slabsOn, updateSlabVersionNotes } from "./slabs";

// A throwaway country whose fiscal year is the calendar year, so the real countries and slabs are never touched.
const CODE = "ZX";
let admin: Awaited<ReturnType<typeof createTempOrg>>;

const rows = (...rates: number[]) => rates.map((rate, i) => ({ upTo: i === rates.length - 1 ? null : (i + 1) * 500000, rate }));
const tables = (single: number[], couple = single) => ({ single: rows(...single), couple: rows(...couple) });
const publish = (over: Partial<Parameters<typeof publishSlabVersion>[1]>) => publishSlabVersion(admin.userId, { countryCode: CODE, headKey: "salary", effectiveFrom: "2026-01-01", tables: tables([1, 10, 20]), isVerified: false, source: "", ...over });
const list = (today = "2026-10-10") => listSlabVersions(CODE, "salary", today);

beforeAll(async () => {
  await db.insert(complianceCountries).values({ code: CODE, name: "Slab test country", currency: "ZZZ", statutoryCalendar: "AD", fiscalYearStartMonth: 1 }).onConflictDoNothing();
  await db.insert(complianceTaxHeads).values([
    { countryCode: CODE, key: "salary", name: "Salary", kind: "slabs", module: "payroll", sortOrder: 0 },
    { countryCode: CODE, key: "rent", name: "Rent", sortOrder: 1 },
  ]).onConflictDoNothing();
  admin = await createTempOrg("ZZ Slabs");
});
afterAll(async () => {
  await db.delete(auditLog).where(and(eq(auditLog.entityType, "platform_slabs"), like(auditLog.entityId, CODE + ":%")));
  await db.delete(platformSlabDrafts).where(eq(platformSlabDrafts.countryCode, CODE));
  await db.delete(platformSlabVersions).where(eq(platformSlabVersions.countryCode, CODE));
  await admin.remove();
  await db.delete(complianceTaxHeads).where(eq(complianceTaxHeads.countryCode, CODE));
  await db.delete(complianceCountries).where(eq(complianceCountries.code, CODE));
});

describe("salary slabs by fiscal year", () => {
  it("publishes the first version and refuses headings that are not worked out from slabs, bad tables and bad dates", async () => {
    expect(await publish({ headKey: "rent" })).toMatchObject({ ok: false, error: expect.stringMatching(/slabs/) });
    expect(await publish({ effectiveFrom: "soon" })).toMatchObject({ ok: false });
    expect(await publish({ tables: { single: rows(1, 10, 20) } })).toMatchObject({ ok: false, error: expect.stringMatching(/Couple/) });
    expect(await publish({ source: "Finance Act 2026", isVerified: true })).toEqual({ ok: true });
    const [v] = await list();
    expect(v).toMatchObject({ fiscalYear: "2026", version: 1, effectiveFrom: "2026-01-01", effectiveTo: null, isVerified: true, source: "Finance Act 2026", inForce: true });
    expect(v.tables.single).toEqual([{ upTo: 500000, rate: 1 }, { upTo: 1000000, rate: 10 }, { upTo: null, rate: 20 }]);
  });

  it("a change during the year is v2, ends v1 the day before, and must really change something", async () => {
    expect(await publish({ effectiveFrom: "2026-07-01", tables: tables([1, 10, 20]) })).toMatchObject({ ok: false, error: expect.stringMatching(/same slabs/) });
    expect(await publish({ effectiveFrom: "2026-01-01", tables: tables([1, 12, 20]) })).toMatchObject({ ok: false });
    expect(await publish({ effectiveFrom: "2026-07-01", tables: tables([1, 12, 20], [1, 10, 20]) })).toEqual({ ok: true });
    const v = await list();
    expect(v.map((x) => [x.fiscalYear, x.version, x.effectiveFrom, x.effectiveTo])).toEqual([["2026", 1, "2026-01-01", "2026-06-30"], ["2026", 2, "2026-07-01", null]]);
  });

  it("finds the slabs that apply on a date, so each payslip can say which version it used", async () => {
    expect((await slabsOn(CODE, "salary", "2026-03-01"))?.tables.single[1].rate).toBe(10);
    expect((await slabsOn(CODE, "salary", "2026-09-01"))?.tables.single[1].rate).toBe(12);
    expect(await slabsOn(CODE, "salary", "2025-12-31")).toBeNull();
  });

  it("verification and the source can be changed later, the slabs cannot", async () => {
    const [v1] = await list();
    expect(await updateSlabVersionNotes(admin.userId, { id: v1.id, isVerified: false, source: "IRD notice" })).toEqual({ ok: true });
    expect((await list())[0]).toMatchObject({ isVerified: false, source: "IRD notice" });
  });

  it("a year before the first version can be set, but a date between two versions cannot", async () => {
    expect(await publish({ effectiveFrom: "2024-01-01", tables: tables([2, 8, 15]) })).toEqual({ ok: true });
    const v = await list();
    expect(v.map((x) => [x.fiscalYear, x.version, x.effectiveTo])).toEqual([["2024", 1, "2025-12-31"], ["2026", 1, "2026-06-30"], ["2026", 2, null]]);
    expect(await publish({ effectiveFrom: "2025-03-01", tables: tables([3, 9, 16]) })).toMatchObject({ ok: false });
  });

  it("carries the slabs forward as a draft near the year end, and confirming publishes it as next year's v1 even when unchanged", async () => {
    await ensureSlabCarryForward(CODE, "2026-06-01");
    expect(await listSlabDrafts(CODE)).toEqual([]);
    await ensureSlabCarryForward(CODE, "2026-11-15");
    await ensureSlabCarryForward(CODE, "2026-12-01"); // twice is the same as once
    const [draft] = await listSlabDrafts(CODE);
    expect(draft).toMatchObject({ headKey: "salary", effectiveFrom: "2027-01-01" });
    expect(draft.tables.single[1].rate).toBe(12);
    expect(await list("2026-12-01")).toHaveLength(3); // nothing published yet

    expect(await confirmSlabDraft(admin.userId, { draftId: draft.id, tables: draft.tables, effectiveFrom: "2028-01-01", source: "", isVerified: false })).toMatchObject({ ok: false, error: expect.stringMatching(/inside fiscal year 2027/) });
    expect(await confirmSlabDraft(admin.userId, { draftId: draft.id, tables: draft.tables, effectiveFrom: "2027-01-01", source: "Carried forward", isVerified: false })).toEqual({ ok: true });
    expect(await listSlabDrafts(CODE)).toEqual([]);
    const v = await list("2027-02-01");
    expect(v.map((x) => [x.fiscalYear, x.version])).toEqual([["2024", 1], ["2026", 1], ["2026", 2], ["2027", 1]]);
    expect(v[2].effectiveTo).toBe("2026-12-31");
    expect(await confirmSlabDraft(admin.userId, { draftId: draft.id, tables: draft.tables, effectiveFrom: "2027-01-01", source: "", isVerified: false })).toMatchObject({ ok: false });
  });

  it("every publish is in the platform audit log", async () => {
    const rows = await db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.entityType, "platform_slabs"), like(auditLog.entityId, CODE + ":%")));
    expect(rows.filter((r) => r.action === "platform_slabs_published").length).toBeGreaterThanOrEqual(4);
    expect(rows.some((r) => r.action === "platform_slabs_updated")).toBe(true);
  });
});
