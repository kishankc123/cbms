import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { attendanceCheckedFor, loadAttendanceMonth, markAttendance, markMonthChecked, unmarkMonthChecked } from "./attendance";

// The attendance of a month: who is on the sheet, which days can be marked, what is stored, and the "month checked" mark that payroll warns about.
let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
let ram: string;
let hari: string;
let gita: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Attendance");
  other = await createTempOrg("ZZ Attendance other");
  const mk = async (code: string, name: string, joiningDate: string, leavingDate?: string) =>
    (await db.insert(employees).values({ tenantId: org.tenantId, employeeCode: code, fullName: name, joiningDate, leavingDate: leavingDate ?? null }).returning())[0].id;
  ram = await mk("E-1", "Ram", "2026-01-01");
  hari = await mk("E-2", "Hari", "2026-10-18");
  gita = await mk("E-3", "Gita", "2026-01-01", "2026-10-20");
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

const mark = (employeeId: string, date: string, status: "present" | "absent" | "leave" | "half_day") => markAttendance(org.tenantId, org.userId, { employeeId, date, status });

describe("marking attendance", () => {
  it("keeps only the exceptions, and marking a day present again removes it", async () => {
    await mark(ram, "2026-10-05", "absent");
    await mark(ram, "2026-10-06", "half_day");
    let m = await loadAttendanceMonth(org.tenantId, "AD", 2026, 10);
    expect(m.records[ram]).toEqual({ "2026-10-05": "absent", "2026-10-06": "half_day" });
    await mark(ram, "2026-10-05", "present");
    m = await loadAttendanceMonth(org.tenantId, "AD", 2026, 10);
    expect(m.records[ram]).toEqual({ "2026-10-06": "half_day" });
  });

  it("refuses days before joining, after leaving, and days to come", async () => {
    await expect(mark(hari, "2026-10-17", "absent")).rejects.toThrow(/had not joined/);
    await mark(hari, "2026-10-18", "absent");
    await expect(mark(gita, "2026-10-21", "absent")).rejects.toThrow(/had left/);
    await mark(gita, "2026-10-20", "leave");
    await expect(mark(ram, "2999-01-01", "absent")).rejects.toThrow(/hasn't come yet/);
  });

  it("leaves another organization's people alone", async () => {
    await expect(markAttendance(other.tenantId, other.userId, { employeeId: ram, date: "2026-10-07", status: "absent" })).rejects.toThrow(/Employee not found/);
  });
});

describe("a month of attendance", () => {
  it("lists the people employed in it, with their days and holidays", async () => {
    const m = await loadAttendanceMonth(org.tenantId, "AD", 2026, 10);
    expect(m.periodStart).toBe("2026-10-01");
    expect(m.periodEnd).toBe("2026-10-31");
    expect(m.days).toHaveLength(31);
    expect(m.employees.map((e) => e.name)).toEqual(["Ram", "Hari", "Gita"]);
    // Saturday is the usual weekly holiday
    expect(m.days.find((d) => d.iso === "2026-10-03")?.holiday).toBe(true);
    expect(m.days.find((d) => d.iso === "2026-10-05")?.holiday).toBe(false);
    // someone who left before the month is not on it
    expect((await loadAttendanceMonth(org.tenantId, "AD", 2026, 11)).employees.map((e) => e.name)).toEqual(["Ram", "Hari"]);
  });

  it("can be marked as checked, and that is undone again", async () => {
    expect((await attendanceCheckedFor(org.tenantId, "AD", 2026, 10)).checked).toBeNull();
    await expect(markMonthChecked(org.tenantId, org.userId, "2999-01-01", "2999-01-31")).rejects.toThrow(/hasn't started/);
    await markMonthChecked(org.tenantId, org.userId, "2026-10-01", "2026-10-31");
    expect((await attendanceCheckedFor(org.tenantId, "AD", 2026, 10)).checked).toMatchObject({ by: expect.any(String) });
    expect((await loadAttendanceMonth(org.tenantId, "AD", 2026, 10)).checked).not.toBeNull();
    // another organization's sheet is not affected
    expect((await attendanceCheckedFor(other.tenantId, "AD", 2026, 10)).checked).toBeNull();
    await unmarkMonthChecked(org.tenantId, org.userId, "2026-10-01");
    expect((await attendanceCheckedFor(org.tenantId, "AD", 2026, 10)).checked).toBeNull();
  });
});
