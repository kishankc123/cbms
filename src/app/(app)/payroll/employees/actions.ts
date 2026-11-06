"use server";

import { nextEmployeeCode } from "@/lib/payroll/employee-code";
import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  employees,
  salaryHistory,
  payrollLines,
  payrollRuns,
  employeeBenefits,
  employeeComponents,
  employeeRetirement,
  payrollComponents,
  auditLog,
  type employmentTypeEnum,
  type employmentStatusEnum,
  type salaryChangeTypeEnum,
  type benefitFrequencyEnum,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getCurrentSalary } from "@/lib/payroll/salary";
import { computeNewSalary } from "@/lib/payroll/salary-change";
import { createEmployeePayableAccount } from "@/lib/ledger/payroll-accounts";

import { todayIso } from "@/lib/calendar";
import { checkEnrolment, type Enrolment } from "@/lib/payroll/employee-retirement";
import type { EmployeeScheme } from "@/lib/payroll/retirement-rules";
const round2 = (n: number) => Math.round(n * 100) / 100;

type EmploymentType = (typeof employmentTypeEnum.enumValues)[number];
type EmploymentStatus = (typeof employmentStatusEnum.enumValues)[number];

export type EmployeeInput = {
  employeeCode: string;
  fullName: string;
  address: string;
  contactNumber: string;
  email: string;
  panNumber: string;
  joiningDate: string;
  /** Last day of employment, if they have left (empty = still employed). */
  leavingDate: string;
  department: string;
  designation: string;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  bankName: string;
  bankAccountNumber: string;
  /** Salary-tax slabs: "single" or "couple" (empty = not chosen yet). */
  taxStatus?: string;
  /** For someone who joined after the fiscal year began: what the earlier employer paid and withheld in it. */
  priorIncome?: string;
  priorTds?: string;
};

// The tax fields, checked: a known status and amounts that are not negative.
function taxFields(input: Pick<EmployeeInput, "taxStatus" | "priorIncome" | "priorTds">) {
  const status = (input.taxStatus ?? "").trim();
  if (status && status !== "single" && status !== "couple") throw new Error("Choose Single or Couple for the tax status");
  const amount = (label: string, v: string | undefined) => {
    const n = v && v.trim() ? Number(v) : 0;
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} has to be an amount of zero or more`);
    return n.toFixed(2);
  };
  return { taxStatus: status || null, priorIncome: amount("Income from the earlier employer", input.priorIncome), priorTds: amount("TDS withheld by the earlier employer", input.priorTds) };
}

// An employee ID (code) is unique within the organization.
async function assertEmployeeCodeFree(tenantId: string, employeeCode: string, excludeEmployeeId?: string) {
  const same = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.employeeCode, employeeCode)));
  if (same.some((e) => e.id !== excludeEmployeeId)) throw new Error(`Employee ID ${employeeCode} is already used by another employee`);
}

// Creating an employee also writes the first salaryHistory row (changeType
// "initial") — an employee must never exist without a salary source-of-truth
// record, since currentBasicSalary is always derived, never stored directly.
/** The ID the next employee will get (shown on the Add new form). It is confirmed when the employee is saved. */
export async function getNextEmployeeCode() {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  return nextEmployeeCode((await db.select({ c: employees.employeeCode }).from(employees).where(eq(employees.tenantId, session.tenantId))).map((r) => r.c));
}

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

// The employee ID is generated (EMP-0001, ...): if two people save at the same moment the database's unique rule makes the
// second pick the next one. An ID may still be passed in (the Edit form can change it later).
export async function createEmployee(input: Omit<EmployeeInput, "employeeCode"> & { employeeCode?: string; initialSalary: number }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");

  const given = (input.employeeCode ?? "").trim();
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Full name is required");
  if (!input.joiningDate) throw new Error("Joining date is required");
  if (input.initialSalary <= 0) throw new Error("Initial basic salary must be greater than zero");
  if (input.leavingDate && input.leavingDate < input.joiningDate) throw new Error("The leaving date can't be before the joining date");
  if (given) await assertEmployeeCodeFree(session.tenantId, given);

  let employee: typeof employees.$inferSelect | undefined;
  let employeeCode = given;
  for (let attempt = 0; attempt < 5 && !employee; attempt++) {
    if (!given) employeeCode = nextEmployeeCode((await db.select({ c: employees.employeeCode }).from(employees).where(eq(employees.tenantId, session.tenantId))).map((r) => r.c));
    try {
      [employee] = await db
        .insert(employees)
        .values({
          tenantId: session.tenantId,
          employeeCode,
          fullName,
          address: input.address.trim() || null,
          contactNumber: input.contactNumber.trim() || null,
          email: input.email.trim() || null,
          panNumber: input.panNumber.trim() || null,
          joiningDate: input.joiningDate,
          leavingDate: input.leavingDate || null,
          department: input.department.trim() || null,
          designation: input.designation.trim() || null,
          employmentType: input.employmentType,
          employmentStatus: input.employmentStatus,
          bankName: input.bankName.trim() || null,
          bankAccountNumber: input.bankAccountNumber.trim() || null,
          ...taxFields(input),
        })
        .returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (given) throw new Error(`Employee ID ${given} is already used by another employee`);
    }
  }
  if (!employee) throw new Error("Could not assign an employee ID. Please try again.");

  // Every employee gets their own Salary Payable sub-account immediately —
  // the liability side payroll accruals post to once a run is finalized.
  const payableAccount = await createEmployeePayableAccount(session.tenantId, fullName);
  await db.update(employees).set({ payableAccountId: payableAccount.id }).where(eq(employees.id, employee.id));

  const salary = round2(input.initialSalary);
  await db.insert(salaryHistory).values({
    tenantId: session.tenantId,
    employeeId: employee.id,
    effectiveFrom: input.joiningDate,
    basicSalary: salary.toFixed(2),
    changeType: "initial",
    previousSalary: null,
    changeAmount: null,
    changePercentage: null,
    reason: "Initial salary",
    createdBy: session.userId,
  });

  // The components the organization gives to everyone start with the employee, from the day they join.
  const everyoneGets = (await db.select({ id: payrollComponents.id }).from(payrollComponents).where(and(eq(payrollComponents.tenantId, session.tenantId), eq(payrollComponents.autoAssign, true), eq(payrollComponents.recurrence, "recurring"))));
  if (everyoneGets.length > 0) await db.insert(employeeComponents).values(everyoneGets.map((c) => ({ tenantId: session.tenantId, employeeId: employee!.id, componentId: c.id, effectiveFrom: input.joiningDate, createdBy: session.userId })));

  await db.insert(auditLog).values({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "create",
    entityType: "employee",
    entityId: employee.id,
    afterValue: { employeeCode, fullName, initialSalary: salary },
  });

  revalidatePath("/payroll/employees");
}

// Only master-data fields — never touches salary. Salary changes must go
// through addSalaryChange so the historical record is never bypassed. Keeps the
// things that hang off the master data in step: a changed joining date moves the
// initial salary record with it, and a rename renames the employee's payable account.
export async function updateEmployee(input: EmployeeInput & { employeeId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");

  const employeeCode = input.employeeCode.trim();
  const fullName = input.fullName.trim();
  if (!employeeCode) throw new Error("Employee ID is required");
  if (!fullName) throw new Error("Full name is required");
  if (!input.joiningDate) throw new Error("Joining date is required");
  if (input.leavingDate && input.leavingDate < input.joiningDate) throw new Error("The leaving date can't be before the joining date");

  const [existing] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId)))
    .limit(1);
  if (!existing) throw new Error("Employee not found");
  await assertEmployeeCodeFree(session.tenantId, employeeCode, existing.id);

  await db
    .update(employees)
    .set({
      employeeCode,
      fullName,
      address: input.address.trim() || null,
      contactNumber: input.contactNumber.trim() || null,
      email: input.email.trim() || null,
      panNumber: input.panNumber.trim() || null,
      joiningDate: input.joiningDate,
      leavingDate: input.leavingDate || null,
      department: input.department.trim() || null,
      designation: input.designation.trim() || null,
      employmentType: input.employmentType,
      employmentStatus: input.employmentStatus,
      bankName: input.bankName.trim() || null,
      bankAccountNumber: input.bankAccountNumber.trim() || null,
      ...taxFields(input),
    })
    .where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId)));

  if (input.joiningDate !== existing.joiningDate) {
    // The initial salary starts the day they join.
    await db
      .update(salaryHistory)
      .set({ effectiveFrom: input.joiningDate })
      .where(and(eq(salaryHistory.tenantId, session.tenantId), eq(salaryHistory.employeeId, existing.id), eq(salaryHistory.changeType, "initial")));
  }
  if (fullName !== existing.fullName && existing.payableAccountId) {
    await db.update(accounts).set({ name: fullName }).where(and(eq(accounts.id, existing.payableAccountId), eq(accounts.tenantId, session.tenantId)));
  }

  revalidatePath("/payroll/employees");
  revalidatePath(`/payroll/employees/${input.employeeId}`);
  revalidatePath("/chart-of-accounts");
}

type ChangeType = (typeof salaryChangeTypeEnum.enumValues)[number];

export type SalaryChangeInput = {
  employeeId: string;
  changeType: Exclude<ChangeType, "initial">;
  changeValue: number; // percentage points or a fixed NPR amount, per changeType; ignored for new_fixed
  newFixedSalary: number; // used only when changeType === "new_fixed"
  effectiveFrom: string;
  reason: string;
  notes: string;
  /**
   * Correct the salary already recorded from the same date instead of refusing. Allowed only while no finalized payroll
   * has used it; the correction is kept in the audit log.
   */
  replaceSameDate?: boolean;
};


// Never updates an existing salary_history row — every change is a new,
// immutable record. The one exception is correcting the salary recorded from the same date (a typo caught
// straight away), which is refused once a finalized payroll has used it and is always kept in the audit log. previousSalary is captured on the row itself so the
// change is self-describing even if earlier rows are later viewed out of
// order.
export async function addSalaryChange(input: SalaryChangeInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");

  if (!input.effectiveFrom) throw new Error("Effective from date is required");
  if (!input.reason.trim()) throw new Error("Reason is required");

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId)))
    .limit(1);
  if (!employee) throw new Error("Employee not found");

  const [same] = await db
    .select()
    .from(salaryHistory)
    .where(and(eq(salaryHistory.tenantId, session.tenantId), eq(salaryHistory.employeeId, input.employeeId), eq(salaryHistory.effectiveFrom, input.effectiveFrom)))
    .limit(1);
  if (same) {
    if (!input.replaceSameDate) throw new Error(`A salary is already recorded from ${input.effectiveFrom}. Choose a later date, or correct that salary.`);
    const [paid] = await db
      .select({ id: payrollLines.id })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
      .where(and(eq(payrollLines.tenantId, session.tenantId), eq(payrollLines.employeeId, input.employeeId), eq(payrollRuns.status, "finalized"), gte(payrollRuns.periodEnd, input.effectiveFrom)))
      .limit(1);
    if (paid) throw new Error("Payroll has already been finalized from that date, so that salary can't be corrected. Record a change from a later date instead.");
    const before = Number(same.basicSalary);
    const base = same.previousSalary === null ? 0 : Number(same.previousSalary);
    const corrected = computeNewSalary(base, input.changeType, input.changeValue, input.newFixedSalary);
    if (corrected <= 0) throw new Error("The resulting salary must be greater than zero");
    const amount = same.previousSalary === null ? null : round2(corrected - base);
    await db
      .update(salaryHistory)
      .set({
        basicSalary: corrected.toFixed(2),
        changeType: same.changeType === "initial" ? "initial" : input.changeType,
        changeAmount: amount === null ? null : amount.toFixed(2),
        changePercentage: amount !== null && base > 0 ? round2((amount / base) * 100).toFixed(2) : null,
        reason: input.reason.trim(),
        notes: input.notes.trim() || null,
      })
      .where(and(eq(salaryHistory.id, same.id), eq(salaryHistory.tenantId, session.tenantId)));
    await db.insert(auditLog).values({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "salary_corrected",
      entityType: "employee",
      entityId: input.employeeId,
      beforeValue: { basicSalary: before, effectiveFrom: input.effectiveFrom },
      afterValue: { basicSalary: corrected, effectiveFrom: input.effectiveFrom, reason: input.reason.trim(), salaryHistoryId: same.id },
    });
    revalidatePath(`/payroll/employees/${input.employeeId}`);
    return;
  }

  const previousSalary = (await getCurrentSalary(session.tenantId, input.employeeId)) ?? 0;
  const newSalary = computeNewSalary(previousSalary, input.changeType, input.changeValue, input.newFixedSalary);
  if (newSalary <= 0) throw new Error("The resulting salary must be greater than zero");

  const changeAmount = round2(newSalary - previousSalary);
  const changePercentage = previousSalary > 0 ? round2((changeAmount / previousSalary) * 100) : null;

  const [record] = await db
    .insert(salaryHistory)
    .values({
      tenantId: session.tenantId,
      employeeId: input.employeeId,
      effectiveFrom: input.effectiveFrom,
      basicSalary: newSalary.toFixed(2),
      changeType: input.changeType,
      previousSalary: previousSalary.toFixed(2),
      changeAmount: changeAmount.toFixed(2),
      changePercentage: changePercentage !== null ? changePercentage.toFixed(2) : null,
      reason: input.reason.trim(),
      notes: input.notes.trim() || null,
      createdBy: session.userId,
    })
    .returning();

  await db.insert(auditLog).values({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "salary_change",
    entityType: "employee",
    entityId: input.employeeId,
    beforeValue: { basicSalary: previousSalary },
    afterValue: { basicSalary: newSalary, effectiveFrom: input.effectiveFrom, reason: input.reason.trim(), salaryHistoryId: record.id },
  });

  revalidatePath(`/payroll/employees/${input.employeeId}`);
}

type Frequency = (typeof benefitFrequencyEnum.enumValues)[number];

export type BenefitInput = {
  employeeId: string;
  benefitType: string;
  amount: number;
  frequency: Frequency;
  effectiveFrom: string;
  notes: string;
};

// Adding a benefit closes any existing open-ended record of the same type
// for this employee (sets its effectiveTo) instead of overwriting it, so the
// old amount stays intact for historical payroll.
export async function addBenefit(input: BenefitInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");

  const benefitType = input.benefitType.trim();
  if (!benefitType) throw new Error("Benefit type is required");
  if (!input.effectiveFrom) throw new Error("Effective from date is required");
  if (input.amount <= 0) throw new Error("Amount must be greater than zero");
  const [owner] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId))).limit(1);
  if (!owner) throw new Error("Employee not found");

  const openEnded = await db
    .select()
    .from(employeeBenefits)
    .where(
      and(
        eq(employeeBenefits.tenantId, session.tenantId),
        eq(employeeBenefits.employeeId, input.employeeId),
        eq(employeeBenefits.benefitType, benefitType),
        eq(employeeBenefits.eligibilityStatus, "active")
      )
    );

  for (const existing of openEnded) {
    if (existing.effectiveTo && existing.effectiveTo < input.effectiveFrom) continue;
    const closeDate = new Date(input.effectiveFrom + "T00:00:00Z");
    closeDate.setUTCDate(closeDate.getUTCDate() - 1);
    await db
      .update(employeeBenefits)
      .set({ effectiveTo: closeDate.toISOString().slice(0, 10) })
      .where(eq(employeeBenefits.id, existing.id));
  }

  await db.insert(employeeBenefits).values({
    tenantId: session.tenantId,
    employeeId: input.employeeId,
    benefitType,
    amount: round2(input.amount).toFixed(2),
    frequency: input.frequency,
    effectiveFrom: input.effectiveFrom,
    notes: input.notes.trim() || null,
    createdBy: session.userId,
  });

  revalidatePath(`/payroll/employees/${input.employeeId}`);
}

export async function deactivateBenefit(input: { benefitId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");

  const [benefit] = await db
    .select()
    .from(employeeBenefits)
    .where(and(eq(employeeBenefits.id, input.benefitId), eq(employeeBenefits.tenantId, session.tenantId)))
    .limit(1);
  if (!benefit) throw new Error("Benefit not found");

  await db
    .update(employeeBenefits)
    .set({ eligibilityStatus: "inactive", effectiveTo: benefit.effectiveTo ?? todayIso() })
    .where(eq(employeeBenefits.id, input.benefitId));

  revalidatePath(`/payroll/employees/${benefit.employeeId}`);
}

export type ComponentAssignmentInput = { employeeId: string; componentId: string; /** null = the catalog's amount */ amount: number | null; effectiveFrom: string; notes: string };

// Gives an employee a component. A recurring one replaces any open one of the same component (the old row ends the day before, so history is kept);
// a one-time one (a bonus, overtime) is just another row dated in the month it should be paid.
export async function assignComponent(input: ComponentAssignmentInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  if (!input.effectiveFrom) throw new Error("Enter the date it starts from");
  if (input.amount !== null && (!Number.isFinite(input.amount) || input.amount < 0)) throw new Error("The amount can't be negative");

  const [employee] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId))).limit(1);
  if (!employee) throw new Error("Employee not found");
  const [component] = await db.select().from(payrollComponents).where(and(eq(payrollComponents.id, input.componentId), eq(payrollComponents.tenantId, session.tenantId))).limit(1);
  if (!component) throw new Error("That component was not found");
  if (component.calcType === "percent" && input.amount !== null && input.amount > 100) throw new Error("A percentage can't be more than 100");
  if (component.recurrence === "one_time" && input.amount === null && Number(component.amount) === 0) throw new Error(`Enter the amount for ${component.name}`);

  if (component.recurrence === "recurring") {
    const open = await db.select().from(employeeComponents).where(and(eq(employeeComponents.tenantId, session.tenantId), eq(employeeComponents.employeeId, input.employeeId), eq(employeeComponents.componentId, input.componentId)));
    for (const row of open) {
      if (row.effectiveTo && row.effectiveTo < input.effectiveFrom) continue;
      if (row.effectiveFrom >= input.effectiveFrom) throw new Error(`${component.name} is already assigned from ${row.effectiveFrom}. Pick a later date, or end it first.`);
      const day = new Date(input.effectiveFrom + "T00:00:00Z");
      day.setUTCDate(day.getUTCDate() - 1);
      await db.update(employeeComponents).set({ effectiveTo: day.toISOString().slice(0, 10) }).where(and(eq(employeeComponents.id, row.id), eq(employeeComponents.tenantId, session.tenantId)));
    }
  }

  await db.insert(employeeComponents).values({ tenantId: session.tenantId, employeeId: input.employeeId, componentId: input.componentId, amount: input.amount === null ? null : round2(input.amount).toFixed(2), effectiveFrom: input.effectiveFrom, notes: input.notes.trim() || null, createdBy: session.userId });
  await db.insert(auditLog).values({ tenantId: session.tenantId, userId: session.userId, action: "assign", entityType: "employee_component", entityId: input.employeeId, afterValue: { component: component.name, amount: input.amount, effectiveFrom: input.effectiveFrom } });
  revalidatePath(`/payroll/employees/${input.employeeId}`);
}

// Ends a recurring component today. A one-time entry is removed instead, as long as no finished payroll run already paid it.
export async function endComponentAssignment(input: { assignmentId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  const [row] = await db.select().from(employeeComponents).where(and(eq(employeeComponents.id, input.assignmentId), eq(employeeComponents.tenantId, session.tenantId))).limit(1);
  if (!row) throw new Error("That assignment was not found");
  const [component] = await db.select().from(payrollComponents).where(and(eq(payrollComponents.id, row.componentId), eq(payrollComponents.tenantId, session.tenantId))).limit(1);

  if (component?.recurrence === "one_time") {
    const [paid] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, session.tenantId), eq(payrollRuns.status, "finalized"), lte(payrollRuns.periodStart, row.effectiveFrom), gte(payrollRuns.periodEnd, row.effectiveFrom))).limit(1);
    if (paid) throw new Error("This was already paid in a finished payroll run, so it can't be removed.");
    await db.delete(employeeComponents).where(and(eq(employeeComponents.id, row.id), eq(employeeComponents.tenantId, session.tenantId)));
  } else {
    const today = todayIso();
    await db.update(employeeComponents).set({ effectiveTo: row.effectiveFrom > today ? row.effectiveFrom : today }).where(and(eq(employeeComponents.id, row.id), eq(employeeComponents.tenantId, session.tenantId)));
  }
  await db.insert(auditLog).values({ tenantId: session.tenantId, userId: session.userId, action: "end", entityType: "employee_component", entityId: row.employeeId, afterValue: { component: component?.name ?? row.componentId } });
  revalidatePath(`/payroll/employees/${row.employeeId}`);
}

export type RetirementInput = { employeeId: string; scheme: EmployeeScheme; registrationNumber: string; startDate: string; endDate: string; citMode: "fixed" | "percent" | null; citValue: number | null; citEmployerValue: number | null; notes: string };

const asEnrolment = (r: typeof employeeRetirement.$inferSelect): Enrolment => ({ id: r.id, scheme: r.scheme as EmployeeScheme, registrationNumber: r.registrationNumber, startDate: r.startDate, endDate: r.endDate, citMode: r.citMode === "percent" ? "percent" : r.citMode === "fixed" ? "fixed" : null, citValue: r.citValue === null ? null : Number(r.citValue), citEmployerValue: r.citEmployerValue === null ? null : Number(r.citEmployerValue) });

// Enrolling someone in SSF, PF or CIT. Nobody is enrolled automatically. SSF and PF can't overlap; CIT can sit beside either.
export async function addRetirement(input: RetirementInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  if (!["ssf", "pf", "cit"].includes(input.scheme)) throw new Error("Choose a retirement scheme");
  const [employee] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId))).limit(1);
  if (!employee) throw new Error("Employee not found");

  const existing = (await db.select().from(employeeRetirement).where(and(eq(employeeRetirement.tenantId, session.tenantId), eq(employeeRetirement.employeeId, input.employeeId)))).map(asEnrolment);
  const isCit = input.scheme === "cit";
  const enrolment: Enrolment = { scheme: input.scheme, registrationNumber: input.registrationNumber.trim() || null, startDate: input.startDate, endDate: input.endDate || null, citMode: isCit ? input.citMode : null, citValue: isCit ? input.citValue : null, citEmployerValue: isCit ? input.citEmployerValue : null };
  const problem = checkEnrolment(enrolment, existing, { joiningDate: employee.joiningDate, leavingDate: employee.leavingDate });
  if (problem) throw new Error(problem);

  await db.insert(employeeRetirement).values({
    tenantId: session.tenantId,
    employeeId: input.employeeId,
    scheme: input.scheme,
    registrationNumber: enrolment.registrationNumber,
    startDate: enrolment.startDate,
    endDate: enrolment.endDate,
    citMode: enrolment.citMode,
    citValue: enrolment.citValue === null ? null : round2(enrolment.citValue).toFixed(2),
    citEmployerValue: enrolment.citEmployerValue === null ? null : round2(enrolment.citEmployerValue).toFixed(2),
    notes: input.notes.trim() || null,
    createdBy: session.userId,
  });
  await db.insert(auditLog).values({ tenantId: session.tenantId, userId: session.userId, action: "enrol", entityType: "employee_retirement", entityId: input.employeeId, afterValue: { scheme: input.scheme, startDate: input.startDate, endDate: input.endDate || null } });
  revalidatePath(`/payroll/employees/${input.employeeId}`);
}

// Ends a scheme on a date (so payroll stops contributing after it). Earlier months keep what they paid.
export async function endRetirement(input: { id: string; endDate: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  const [row] = await db.select().from(employeeRetirement).where(and(eq(employeeRetirement.id, input.id), eq(employeeRetirement.tenantId, session.tenantId))).limit(1);
  if (!row) throw new Error("That enrolment was not found");
  if (!input.endDate) throw new Error("Enter the last day of contributions");
  if (input.endDate < row.startDate) throw new Error(`The end date can't be before the start date (${row.startDate}).`);
  // Months already finalized keep their figures, so a scheme can't be ended before a period that was already paid with it.
  const [paid] = await db
    .select({ end: payrollRuns.periodEnd })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
    .where(and(eq(payrollLines.tenantId, session.tenantId), eq(payrollLines.employeeId, row.employeeId), eq(payrollRuns.status, "finalized"), gte(payrollRuns.periodEnd, input.endDate)))
    .orderBy(desc(payrollRuns.periodEnd))
    .limit(1);
  if (paid) throw new Error(`Payroll up to ${paid.end} is already finalized for this employee, so the scheme can't end before then. Reverse that run first, or end it from a later date.`);
  await db.update(employeeRetirement).set({ endDate: input.endDate }).where(and(eq(employeeRetirement.id, row.id), eq(employeeRetirement.tenantId, session.tenantId)));
  await db.insert(auditLog).values({ tenantId: session.tenantId, userId: session.userId, action: "end", entityType: "employee_retirement", entityId: row.employeeId, afterValue: { scheme: row.scheme, endDate: input.endDate } });
  revalidatePath(`/payroll/employees/${row.employeeId}`);
}

// Tax residency and whether the employee is confirmed for the first-band exemption. Both are recorded in the audit log.
export async function updateTaxInfo(input: { employeeId: string; taxResidency: "resident" | "non_resident"; sstEligible: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  if (input.taxResidency !== "resident" && input.taxResidency !== "non_resident") throw new Error("Choose resident or non-resident");
  const [employee] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId))).limit(1);
  if (!employee) throw new Error("Employee not found");
  await db.update(employees).set({ taxResidency: input.taxResidency, sstEligible: input.sstEligible }).where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId)));
  await db.insert(auditLog).values({ tenantId: session.tenantId, userId: session.userId, action: "update", entityType: "employee_tax", entityId: input.employeeId, beforeValue: { taxResidency: employee.taxResidency, sstEligible: employee.sstEligible }, afterValue: { taxResidency: input.taxResidency, sstEligible: input.sstEligible } });
  revalidatePath(`/payroll/employees/${input.employeeId}`);
}
