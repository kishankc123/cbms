"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { plannedEvents, vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { validateEvent, type EventInput } from "@/lib/dashboard/planning-rules";

type Result = { ok: true } | { ok: false; error: string };

const money = (n: number | null) => (n === null ? null : n.toFixed(2));

async function values(tenantId: string, e: EventInput) {
  if (e.vendorId) {
    const [v] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, e.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
    if (!v) return null;
  }
  return {
    name: e.name.trim(),
    category: e.category,
    vendorId: e.vendorId,
    estimate: e.estimate.toFixed(2),
    low: money(e.low),
    high: money(e.high),
    earliestDate: e.earliestDate,
    latestDate: e.latestDate,
    plannedDate: e.plannedDate,
    pattern: e.pattern,
    advancePct: e.advancePct,
    balanceDays: e.balanceDays,
    instalments: e.instalments,
    intervalDays: e.intervalDays,
    creditDays: e.creditDays,
    urgency: e.urgency,
    salesEffect: e.salesEffect,
    salesEffectMonthly: money(e.salesEffectMonthly),
    salesEffectDays: e.salesEffectDays,
    notes: e.notes?.trim() || null,
  };
}

// Planning spending is a finance decision about money going out, so it follows who may create expenses. A plan posts nothing.
export async function savePlannedEvent(eventId: string | null, input: EventInput): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) return { ok: false, error: "You do not have permission to plan spending." };
  const problem = validateEvent(input);
  if (problem) return { ok: false, error: problem };
  const v = await values(session.tenantId, input);
  if (!v) return { ok: false, error: "That supplier could not be found." };

  if (eventId) {
    const updated = await db
      .update(plannedEvents)
      .set({ ...v, updatedAt: new Date() })
      .where(and(eq(plannedEvents.id, eventId), eq(plannedEvents.tenantId, session.tenantId)))
      .returning({ id: plannedEvents.id });
    if (updated.length === 0) return { ok: false, error: "That event could not be found." };
  } else {
    await db.insert(plannedEvents).values({ tenantId: session.tenantId, createdBy: session.userId, ...v });
  }
  revalidatePath("/dashboard/planning");
  return { ok: true };
}

/** Done: the money has been spent and is in the books. Cancelled: no longer planned. Either way it leaves the plan, and stays in the table. */
export async function closePlannedEvent(eventId: string, status: "done" | "cancelled"): Promise<Result> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) return { ok: false, error: "You do not have permission to plan spending." };
  const updated = await db
    .update(plannedEvents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(plannedEvents.id, eventId), eq(plannedEvents.tenantId, session.tenantId)))
    .returning({ id: plannedEvents.id });
  if (updated.length === 0) return { ok: false, error: "That event could not be found." };
  revalidatePath("/dashboard/planning");
  return { ok: true };
}
