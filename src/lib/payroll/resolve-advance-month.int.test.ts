import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { resolveAdvanceMonth } from "./staff-advances";

// A staff advance with no month chosen is recovered from the month of its date, or the next month whose payroll is still open.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;

beforeAll(async () => {
  org = await createTempOrg("ZZ Advance Month");
});
afterAll(async () => {
  await org.remove();
});

describe("the month an advance is recovered from when none is chosen", () => {
  it("is the month of the advance's own date while that month is open", async () => {
    expect(await resolveAdvanceMonth(org.tenantId, "AD", "2026-09-18")).toEqual({ calendar: "AD", month: 9, year: 2026 });
  });

  it("moves to the next open month once that month's payroll is finalized, across a year end", async () => {
    await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "AD", month: 9, year: 2026, periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "finalized", createdBy: org.userId });
    expect(await resolveAdvanceMonth(org.tenantId, "AD", "2026-09-18")).toEqual({ calendar: "AD", month: 10, year: 2026 });
    await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "AD", month: 10, year: 2026, periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "finalized", createdBy: org.userId });
    await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "AD", month: 11, year: 2026, periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "finalized", createdBy: org.userId });
    await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "AD", month: 12, year: 2026, periodStart: "2026-12-01", periodEnd: "2026-12-31", status: "finalized", createdBy: org.userId });
    expect(await resolveAdvanceMonth(org.tenantId, "AD", "2026-09-18")).toEqual({ calendar: "AD", month: 1, year: 2027 });
  });

  it("is the date's own month again once past the finalized runs", async () => {
    expect(await resolveAdvanceMonth(org.tenantId, "AD", "2027-03-05")).toEqual({ calendar: "AD", month: 3, year: 2027 });
  });
});
