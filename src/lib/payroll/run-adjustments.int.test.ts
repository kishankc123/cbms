import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeComponents, employees, payrollComponents, payrollLines, payrollRuns } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { componentPay, type CatalogComponent } from "./components";
import { addRunAdjustment, listRunAdjustments, removeRunAdjustment, type RunPeriod } from "./run-adjustments";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let run: RunPeriod;
let emp: string;
const START = "2026-10-18";
const END = "2026-11-16";

beforeAll(async () => {
  org = await createTempOrg("ZZ Adjustments");
  const [e] = await db.insert(employees).values({ tenantId: org.tenantId, employeeCode: "A-1", fullName: "Sita Sharma", joiningDate: "2026-01-01" }).returning();
  emp = e.id;
  const [r] = await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "BS", month: 7, year: 2083, periodStart: START, periodEnd: END, createdBy: org.userId }).returning();
  await db.insert(payrollLines).values({ tenantId: org.tenantId, payrollRunId: r.id, employeeId: emp, basicSalary: "30000", workingDays: "30", presentDays: "30", absentDays: "0", proratedBasic: "30000", allowances: "0", deductions: "0", overtimeAmount: "0", benefitsAmount: "0", grossPay: "30000", taxablePay: "30000", tdsAmount: "0", netPay: "30000" });
  run = { id: r.id, periodStart: START, periodEnd: END, status: r.status };
});
afterAll(async () => {
  await org.remove();
});

const add = (kind: string, amount: number, reason = "Festival gift") => addRunAdjustment(org.tenantId, org.userId, run, { employeeId: emp, kind, amount, reason });

/** What the salary sheet would work out for this person from the adjustments, using the same function the run uses. */
async function pay() {
  const catalogRows = await db.select().from(payrollComponents).where(eq(payrollComponents.tenantId, org.tenantId));
  const catalog: CatalogComponent[] = catalogRows.map((c) => ({ id: c.id, name: c.name, type: c.type, amount: Number(c.amount), taxable: c.taxable, calcType: c.calcType === "percent" ? "percent" : "fixed", countsForRetirement: c.countsForRetirement, recurrence: c.recurrence === "one_time" ? "one_time" : "recurring" }));
  const rows = await db.select().from(employeeComponents).where(and(eq(employeeComponents.tenantId, org.tenantId), eq(employeeComponents.employeeId, emp)));
  return componentPay(catalog, rows.map((a) => ({ componentId: a.componentId, amount: a.amount === null ? null : Number(a.amount), effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo })), { periodStart: START, periodEnd: END, proratedBasic: 30000 });
}

describe("one-off adjustments on a salary sheet", () => {
  it("a taxable allowance is taxable and counts towards retirement, and is listed with its reason", async () => {
    await add("allowance", 2000);
    const p = await pay();
    expect(p.allowances).toBe(2000);
    expect(p.taxableAllowances).toBe(2000);
    expect(p.retirementAllowances).toBe(2000);
    expect(await listRunAdjustments(org.tenantId, run)).toMatchObject([{ employeeName: "Sita Sharma", kind: "allowance", amount: 2000, reason: "Festival gift" }]);
  });

  it("a non-taxable allowance is neither taxable nor counted for retirement", async () => {
    await add("allowance_free", 500, "Travel refund");
    const p = await pay();
    expect(p.allowances).toBe(2500);
    expect(p.taxableAllowances).toBe(2000);
    expect(p.retirementAllowances).toBe(2000);
  });

  it("a deduction only takes from the pay", async () => {
    await add("deduction", 300, "Damaged equipment");
    const p = await pay();
    expect(p.deductions).toBe(300);
    expect(p.allowances).toBe(2500);
    expect(p.taxableAllowances).toBe(2000);
  });

  it("can be removed, and then no longer counts", async () => {
    const list = await listRunAdjustments(org.tenantId, run);
    expect(list).toHaveLength(3);
    await removeRunAdjustment(org.tenantId, org.userId, run, list.find((a) => a.kind === "deduction")!.id);
    expect((await pay()).deductions).toBe(0);
    expect(await listRunAdjustments(org.tenantId, run)).toHaveLength(2);
  });

  it("refuses bad input in plain words, an employee who is not in the run, and a finalized run", async () => {
    await expect(add("allowance", 0)).rejects.toThrow(/greater than zero/);
    await expect(add("allowance", 100, "  ")).rejects.toThrow(/short reason/);
    await expect(add("bonus", 100)).rejects.toThrow(/what kind/);
    await expect(addRunAdjustment(org.tenantId, org.userId, run, { employeeId: "00000000-0000-0000-0000-000000000000", kind: "allowance", amount: 5, reason: "Test" })).rejects.toThrow(/not in this payroll run/);
    await expect(addRunAdjustment(org.tenantId, org.userId, { ...run, status: "finalized" }, { employeeId: emp, kind: "allowance", amount: 5, reason: "Test" })).rejects.toThrow(/finalized/);
    await expect(removeRunAdjustment(org.tenantId, org.userId, run, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not on this payroll run/);
  });

  it("an adjustment dated outside the run's period does not appear on it", async () => {
    const other = { ...run, periodStart: "2026-12-01", periodEnd: "2026-12-30" };
    expect(await listRunAdjustments(org.tenantId, other)).toEqual([]);
  });
});
