import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeComponents, employees, payrollComponents, payrollLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee, assignComponent, endComponentAssignment } = await import("./employees/actions");
const { createComponent, addStarterComponents } = await import("./setup/actions");
const { generatePayrollRun } = await import("./salary-sheet/actions");

const empInput = (code: string, name: string) => ({
  employeeCode: code, fullName: name, address: "", contactNumber: "", email: "", panNumber: "", joiningDate: "2026-01-01", leavingDate: "", department: "", designation: "",
  employmentType: "full_time" as const, employmentStatus: "active" as const, bankName: "", bankAccountNumber: "", initialSalary: 60000, taxStatus: "single",
});
const idOf = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0].id;
const compId = async (name: string) => (await db.select().from(payrollComponents).where(and(eq(payrollComponents.tenantId, org.tenantId), eq(payrollComponents.name, name))))[0].id;
const lineOf = async (runId: string, employeeId: string) => (await db.select().from(payrollLines).where(and(eq(payrollLines.payrollRunId, runId), eq(payrollLines.employeeId, employeeId))))[0];
const base = { type: "allowance" as const, taxable: true, calcType: "fixed" as const, countsForRetirement: false, recurrence: "recurring" as const, autoAssign: false };

beforeAll(async () => {
  org = await createTempOrg("ZZ Salary components");
});
afterAll(async () => {
  await org.remove();
});

describe("salary components per employee", () => {
  it("gives everyone a component marked for everyone, and only the chosen employees the others", async () => {
    await createComponent({ ...base, name: "House Rent", amount: 2000, autoAssign: true });
    await createComponent({ ...base, name: "Travel", amount: 500, taxable: false });
    await createComponent({ ...base, name: "Overtime", amount: 0, recurrence: "one_time" });
    await createComponent({ ...base, name: "Meal Deduction", type: "deduction", amount: 300 });
    await createEmployee(empInput("C-1", "Asha"));
    await createEmployee(empInput("C-2", "Bikram"));
    const [a, b] = [await idOf("C-1"), await idOf("C-2")];
    // new employees got House Rent from the day they joined, and nothing else
    expect((await db.select().from(employeeComponents).where(eq(employeeComponents.employeeId, a))).map((r) => r.effectiveFrom)).toEqual(["2026-01-01"]);

    await assignComponent({ employeeId: b, componentId: await compId("Travel"), amount: null, effectiveFrom: "2026-01-01", notes: "" });
    await assignComponent({ employeeId: a, componentId: await compId("Overtime"), amount: 1200, effectiveFrom: "2026-03-15", notes: "March overtime" });
    await assignComponent({ employeeId: a, componentId: await compId("Meal Deduction"), amount: 150, effectiveFrom: "2026-01-01", notes: "" });

    const march = await generatePayrollRun({ month: 3, year: 2026, calendar: "AD", employeeIds: [a, b] });
    const la = await lineOf(march, a);
    const lb = await lineOf(march, b);
    // A: 60,000 + 2,000 house rent + 1,200 overtime, less a 150 deduction; B: 60,000 + 2,000 + 500 travel
    expect(Number(la.grossPay)).toBe(63200);
    expect(Number(la.allowances)).toBe(3200);
    expect(Number(la.deductions)).toBe(150);
    expect(Number(lb.grossPay)).toBe(62500);
    expect(Number(lb.deductions)).toBe(0);
    // taxable pay leaves out the non-taxable travel allowance
    expect(Number(lb.taxablePay)).toBe(62000);
    expect((la.componentsDetail as { name: string; amount: number }[]).map((l) => [l.name, l.amount]).sort()).toEqual([["House Rent", 2000], ["Meal Deduction", 150], ["Overtime", 1200]]);

    // the one-time overtime is in March only
    const april = await generatePayrollRun({ month: 4, year: 2026, calendar: "AD", employeeIds: [a, b] });
    expect(Number((await lineOf(april, a)).allowances)).toBe(2000);
  });

  it("a changed amount ends the old row the day before, and stopping keeps earlier months", async () => {
    const b = await idOf("C-2");
    const travel = await compId("Travel");
    await assignComponent({ employeeId: b, componentId: travel, amount: 800, effectiveFrom: "2026-06-01", notes: "" });
    const rows = await db.select().from(employeeComponents).where(and(eq(employeeComponents.employeeId, b), eq(employeeComponents.componentId, travel)));
    expect(rows.map((r) => [Number(r.amount ?? 0), r.effectiveFrom, r.effectiveTo]).sort()).toEqual([[0, "2026-01-01", "2026-05-31"], [800, "2026-06-01", null]]);
    // May still uses the old (catalog) amount, June the new one
    expect(Number((await lineOf(await generatePayrollRun({ month: 5, year: 2026, calendar: "AD", employeeIds: [b] }), b)).allowances)).toBe(2500);
    expect(Number((await lineOf(await generatePayrollRun({ month: 6, year: 2026, calendar: "AD", employeeIds: [b] }), b)).allowances)).toBe(2800);
    // assigning again from the same or an earlier date is refused
    await expect(assignComponent({ employeeId: b, componentId: travel, amount: 900, effectiveFrom: "2026-06-01", notes: "" })).rejects.toThrow(/already assigned/);
  });

  it("a percentage works on the basic paid, and a component can be removed from one employee only", async () => {
    await createComponent({ ...base, name: "Dearness", amount: 10, calcType: "percent", countsForRetirement: true });
    const [a, b] = [await idOf("C-1"), await idOf("C-2")];
    await assignComponent({ employeeId: a, componentId: await compId("Dearness"), amount: null, effectiveFrom: "2026-07-01", notes: "" });
    const july = await generatePayrollRun({ month: 7, year: 2026, calendar: "AD", employeeIds: [a, b] });
    expect(Number((await lineOf(july, a)).allowances)).toBe(2000 + 6000);
    expect(Number((await lineOf(july, b)).allowances)).toBe(2000 + 800);
    expect((await lineOf(july, a)).componentsDetail).toContainEqual(expect.objectContaining({ name: "Dearness", countsForRetirement: true, amount: 6000 }));
    const [row] = await db.select().from(employeeComponents).where(and(eq(employeeComponents.employeeId, a), eq(employeeComponents.componentId, await compId("Dearness"))));
    await endComponentAssignment({ assignmentId: row.id });
    expect((await db.select().from(employeeComponents).where(eq(employeeComponents.id, row.id)))[0].effectiveTo).not.toBeNull();
  });

  it("adds the suggested set once, without duplicating what is already there", async () => {
    const first = await addStarterComponents();
    expect(first).toBeGreaterThan(0);
    expect(await addStarterComponents()).toBe(0);
    const [bonus] = await db.select().from(payrollComponents).where(and(eq(payrollComponents.tenantId, org.tenantId), eq(payrollComponents.name, "Bonus")));
    expect(bonus.recurrence).toBe("one_time");
  });
});
