"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  payrollSettings,
  payrollComponents,
  type prorationMethodEnum,
  type workingDaysMethodEnum,
  type payrollComponentTypeEnum,
} from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

type ProrationMethod = (typeof prorationMethodEnum.enumValues)[number];
type WorkingDaysMethod = (typeof workingDaysMethodEnum.enumValues)[number];
type ComponentType = (typeof payrollComponentTypeEnum.enumValues)[number];

export async function getOrCreateSettings(tenantId: string) {
  const [existing] = await db.select().from(payrollSettings).where(eq(payrollSettings.tenantId, tenantId)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(payrollSettings).values({ tenantId }).returning();
  return created;
}

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

export async function createComponent(input: { name: string; type: ComponentType; amount: number; taxable: boolean }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "create")) throw new Error("Not permitted");

  const name = input.name.trim();
  if (!name) throw new Error("Component name is required");
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error("The amount can't be negative");
  const same = await db.select({ id: payrollComponents.id }).from(payrollComponents).where(and(eq(payrollComponents.tenantId, session.tenantId), eq(payrollComponents.name, name)));
  if (same.length > 0) throw new Error(`There is already a payroll component called ${name}`);

  await db.insert(payrollComponents).values({
    tenantId: session.tenantId,
    name,
    type: input.type,
    amount: input.amount.toFixed(2),
    taxable: input.taxable,
  });

  revalidatePath("/payroll/setup");
}

export async function deleteComponent(input: { componentId: string }) {
  const session = await requireTenantSession();
  if (!can(session, "payroll", "delete")) throw new Error("Not permitted");

  await db
    .delete(payrollComponents)
    .where(and(eq(payrollComponents.id, input.componentId), eq(payrollComponents.tenantId, session.tenantId)));

  revalidatePath("/payroll/setup");
}
