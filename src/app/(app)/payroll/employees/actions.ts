"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  salaryHistory,
  employeeBenefits,
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
  department: string;
  designation: string;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  bankName: string;
  bankAccountNumber: string;
};

// Creating an employee also writes the first salaryHistory row (changeType
// "initial") — an employee must never exist without a salary source-of-truth
// record, since currentBasicSalary is always derived, never stored directly.
export async function createEmployee(input: EmployeeInput & { initialSalary: number }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");

  const employeeCode = input.employeeCode.trim();
  const fullName = input.fullName.trim();
  if (!employeeCode) throw new Error("Employee ID is required");
  if (!fullName) throw new Error("Full name is required");
  if (!input.joiningDate) throw new Error("Joining date is required");
  if (input.initialSalary <= 0) throw new Error("Initial basic salary must be greater than zero");

  const [employee] = await db
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
      department: input.department.trim() || null,
      designation: input.designation.trim() || null,
      employmentType: input.employmentType,
      employmentStatus: input.employmentStatus,
      bankName: input.bankName.trim() || null,
      bankAccountNumber: input.bankAccountNumber.trim() || null,
    })
    .returning();

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
// through addSalaryChange so the historical record is never bypassed.
export async function updateEmployee(input: EmployeeInput & { employeeId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");

  const employeeCode = input.employeeCode.trim();
  const fullName = input.fullName.trim();
  if (!employeeCode) throw new Error("Employee ID is required");
  if (!fullName) throw new Error("Full name is required");

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
      department: input.department.trim() || null,
      designation: input.designation.trim() || null,
      employmentType: input.employmentType,
      employmentStatus: input.employmentStatus,
      bankName: input.bankName.trim() || null,
      bankAccountNumber: input.bankAccountNumber.trim() || null,
    })
    .where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId)));

  revalidatePath("/payroll/employees");
  revalidatePath(`/payroll/employees/${input.employeeId}`);
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
};


// Never updates an existing salary_history row — every change is a new,
// immutable record. previousSalary is captured on the row itself so the
// change is self-describing even if earlier rows are later viewed out of
// order.
export async function addSalaryChange(input: SalaryChangeInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");

  if (!input.effectiveFrom) throw new Error("Effective from date is required");
  if (!input.reason.trim()) throw new Error("Reason is required");

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, input.employeeId), eq(employees.tenantId, session.tenantId)))
    .limit(1);
  if (!employee) throw new Error("Employee not found");

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

  const benefitType = input.benefitType.trim();
  if (!benefitType) throw new Error("Benefit type is required");
  if (!input.effectiveFrom) throw new Error("Effective from date is required");
  if (input.amount <= 0) throw new Error("Amount must be greater than zero");

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
