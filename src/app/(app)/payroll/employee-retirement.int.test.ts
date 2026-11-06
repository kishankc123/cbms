import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeRetirement, employees } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const { createEmployee, addRetirement, endRetirement, updateTaxInfo } = await import("./employees/actions");
const { generatePayrollRun } = await import("./salary-sheet/actions");

const empInput = (code: string) => ({
  employeeCode: code, fullName: `Emp ${code}`, address: "", contactNumber: "", email: "", panNumber: "", joiningDate: "2026-01-01", leavingDate: "", department: "", designation: "",
  employmentType: "full_time" as const, employmentStatus: "active" as const, bankName: "", bankAccountNumber: "", initialSalary: 60000, taxStatus: "single",
});
const idOf = async (code: string) => (await db.select().from(employees).where(and(eq(employees.tenantId, org.tenantId), eq(employees.employeeCode, code))))[0].id;
const enrol = (employeeId: string, over: Partial<Parameters<typeof addRetirement>[0]> = {}) =>
  addRetirement({ employeeId, scheme: "ssf", registrationNumber: "S-100", startDate: "2026-07-17", endDate: "", citMode: null, citValue: null, citEmployerValue: null, notes: "", ...over });

beforeAll(async () => {
  org = await createTempOrg("ZZ Retirement");
});
afterAll(async () => {
  await org.remove();
});

describe("retirement enrolment", () => {
  it("nobody is enrolled by default, and a new employee has residency resident and no exemption", async () => {
    await createEmployee(empInput("R-1"));
    const id = await idOf("R-1");
    expect(await db.select().from(employeeRetirement).where(eq(employeeRetirement.employeeId, id))).toEqual([]);
    const [e] = await db.select().from(employees).where(eq(employees.id, id));
    expect(e).toMatchObject({ taxResidency: "resident", sstEligible: false });
  });

  it("enrols in SSF, refuses PF beside it and a second SSF, and allows CIT beside it", async () => {
    const id = await idOf("R-1");
    await enrol(id);
    await expect(enrol(id, { scheme: "pf", registrationNumber: "", startDate: "2026-09-01" })).rejects.toThrow(/SSF and PF/);
    await expect(enrol(id, { startDate: "2026-09-01" })).rejects.toThrow(/already recorded/);
    await expect(enrol(id, { scheme: "ssf", registrationNumber: "", startDate: "2027-09-01", endDate: "" })).rejects.toThrow(/registration number|already recorded/);
    await enrol(id, { scheme: "cit", registrationNumber: "", citMode: "fixed", citValue: 2000, citEmployerValue: null });
    expect((await db.select().from(employeeRetirement).where(eq(employeeRetirement.employeeId, id))).map((r) => r.scheme).sort()).toEqual(["cit", "ssf"]);
    // before joining is refused
    await expect(enrol(id, { scheme: "pf", registrationNumber: "", startDate: "2025-01-01", endDate: "2025-12-31" })).rejects.toThrow(/joined/);
  });

  it("changes scheme by ending one and starting the other, and keeps the history", async () => {
    const id = await idOf("R-1");
    const [ssf] = await db.select().from(employeeRetirement).where(and(eq(employeeRetirement.employeeId, id), eq(employeeRetirement.scheme, "ssf")));
    await expect(endRetirement({ id: ssf.id, endDate: "2026-01-01" })).rejects.toThrow(/before the start/);
    await endRetirement({ id: ssf.id, endDate: "2026-09-30" });
    await enrol(id, { scheme: "pf", registrationNumber: "P-9", startDate: "2026-10-01" });
    expect((await db.select().from(employeeRetirement).where(eq(employeeRetirement.employeeId, id))).map((r) => [r.scheme, r.startDate, r.endDate]).sort()).toEqual([["cit", "2026-07-17", null], ["pf", "2026-10-01", null], ["ssf", "2026-07-17", "2026-09-30"]]);
  });

  it("records residency and the exemption confirmation, and does not change any payroll figure", async () => {
    await createEmployee(empInput("R-2"));
    const id = await idOf("R-2");
    const before = await generatePayrollRun({ month: 8, year: 2026, calendar: "AD", employeeIds: [id] });
    await enrol(id);
    await updateTaxInfo({ employeeId: id, taxResidency: "non_resident", sstEligible: true });
    const [e] = await db.select().from(employees).where(eq(employees.id, id));
    expect(e).toMatchObject({ taxResidency: "non_resident", sstEligible: true });
    // the run is not affected yet: contributions are worked out in the next step
    const after = await generatePayrollRun({ month: 8, year: 2026, calendar: "AD", employeeIds: [id] });
    expect(after).toBe(before);
    await expect(updateTaxInfo({ employeeId: id, taxResidency: "unknown" as never, sstEligible: false })).rejects.toThrow(/resident/);
  });
});
