"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  payrollSettings,
  payrollComponents,
  employees,
  employeeComponents,
  type prorationMethodEnum,
  type workingDaysMethodEnum,
  type payrollComponentTypeEnum,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getOrCreateSettings } from "@/lib/payroll/settings";
import { STARTER_COMPONENTS } from "@/lib/payroll/components";
import { todayIso } from "@/lib/calendar";

type ProrationMethod = (typeof prorationMethodEnum.enumValues)[number];
type WorkingDaysMethod = (typeof workingDaysMethodEnum.enumValues)[number];
type ComponentType = (typeof payrollComponentTypeEnum.enumValues)[number];

export async function updateSettings(input: {
  prorationMethod: ProrationMethod;
  workingDaysMethod: WorkingDaysMethod;
  weeklyHolidays: number[];
  publicHolidays: string[];
  payrollStartDay: number;
  payrollEndDay: number;
  roundingRule: string;
}) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "view")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (input.weeklyHolidays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Weekly holidays must be days of the week");
  if (input.publicHolidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("Public holidays must be valid dates");
  if (![input.payrollStartDay, input.payrollEndDay].every((d) => Number.isInteger(d) && d >= 1 && d <= 32)) throw new Error("The payroll start and end days must be between 1 and 32");
  if (input.payrollStartDay > input.payrollEndDay) throw new Error("The payroll start day can't be after the end day");

  await getOrCreateSettings(session.tenantId);
  await db
    .update(payrollSettings)
    .set({
      prorationMethod: input.prorationMethod,
      workingDaysMethod: input.workingDaysMethod,
      weeklyHolidays: input.weeklyHolidays,
      publicHolidays: input.publicHolidays,
      payrollStartDay: input.payrollStartDay,
      payrollEndDay: input.payrollEndDay,
      roundingRule: input.roundingRule,
    })
    .where(eq(payrollSettings.tenantId, session.tenantId));

  revalidatePath("/payroll/setup");
}

export type ComponentInput = { name: string; type: ComponentType; amount: number; taxable: boolean; calcType: "fixed" | "percent"; countsForRetirement: boolean; recurrence: "recurring" | "one_time"; autoAssign: boolean };

function checkComponent(input: ComponentInput) {
  if (!input.name.trim()) throw new Error("Component name is required");
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error("The amount can't be negative");
  if (input.calcType === "percent" && input.amount > 100) throw new Error("A percentage can't be more than 100");
  if (input.type === "deduction" && input.countsForRetirement) throw new Error("Only an allowance can count toward the retirement basis");
}

// A new component with "give to every employee" is also assigned to the employees already there, from today (so earlier months do not change).
async function assignToEveryone(tenantId: string, componentId: string, userId: string) {
  const everyone = await db.select({ id: employees.id, joiningDate: employees.joiningDate }).from(employees).where(eq(employees.tenantId, tenantId));
  const today = todayIso();
  if (everyone.length === 0) return;
  await db.insert(employeeComponents).values(everyone.map((e) => ({ tenantId, employeeId: e.id, componentId, effectiveFrom: e.joiningDate > today ? e.joiningDate : today, createdBy: userId })));
}

export async function createComponent(input: ComponentInput) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");

  const name = input.name.trim();
  checkComponent(input);
  const same = await db.select({ id: payrollComponents.id }).from(payrollComponents).where(and(eq(payrollComponents.tenantId, session.tenantId), eq(payrollComponents.name, name)));
  if (same.length > 0) throw new Error(`There is already a payroll component called ${name}`);

  const [created] = await db
    .insert(payrollComponents)
    .values({ tenantId: session.tenantId, name, type: input.type, amount: input.amount.toFixed(2), taxable: input.taxable, calcType: input.calcType, countsForRetirement: input.countsForRetirement, recurrence: input.recurrence, autoAssign: input.autoAssign })
    .returning();
  if (input.autoAssign && input.recurrence === "recurring") await assignToEveryone(session.tenantId, created.id, session.userId);

  revalidatePath("/payroll/setup");
}

export async function updateComponent(input: ComponentInput & { componentId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "edit")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  checkComponent(input);
  const name = input.name.trim();
  const [current] = await db.select().from(payrollComponents).where(and(eq(payrollComponents.id, input.componentId), eq(payrollComponents.tenantId, session.tenantId))).limit(1);
  if (!current) throw new Error("That component was not found");
  const clash = (await db.select({ id: payrollComponents.id }).from(payrollComponents).where(and(eq(payrollComponents.tenantId, session.tenantId), eq(payrollComponents.name, name)))).some((r) => r.id !== input.componentId);
  if (clash) throw new Error(`There is already a payroll component called ${name}`);
  // Changing it changes the draft months still to be generated; finished payroll keeps its own figures.
  await db
    .update(payrollComponents)
    .set({ name, type: input.type, amount: input.amount.toFixed(2), taxable: input.taxable, calcType: input.calcType, countsForRetirement: input.countsForRetirement, recurrence: input.recurrence, autoAssign: input.autoAssign })
    .where(and(eq(payrollComponents.id, input.componentId), eq(payrollComponents.tenantId, session.tenantId)));
  revalidatePath("/payroll/setup");
}

/** Adds the suggested earnings (amount 0, assigned by hand) that the organization does not have yet. */
export async function addStarterComponents() {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  const have = new Set((await db.select({ name: payrollComponents.name }).from(payrollComponents).where(eq(payrollComponents.tenantId, session.tenantId))).map((r) => r.name));
  const missing = STARTER_COMPONENTS.filter((c) => !have.has(c.name));
  if (missing.length > 0) await db.insert(payrollComponents).values(missing.map((c) => ({ tenantId: session.tenantId, name: c.name, type: "allowance" as const, amount: "0", taxable: true, recurrence: c.recurrence })));
  revalidatePath("/payroll/setup");
  return missing.length;
}

export async function deleteComponent(input: { componentId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "delete")) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");

  await db
    .delete(payrollComponents)
    .where(and(eq(payrollComponents.id, input.componentId), eq(payrollComponents.tenantId, session.tenantId)));

  revalidatePath("/payroll/setup");
}
