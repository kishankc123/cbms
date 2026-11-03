"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { planningSettings } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";

export type PlanningInput = { reserveMonths: number; reserveOverride: number | null; defaultCollectionDays: number | null };

export async function savePlanningSettings(input: PlanningInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireTenantSession();
  if (!can(session, "settings", "edit")) return { ok: false, error: "You do not have permission to change the planning settings." };

  if (!Number.isInteger(input.reserveMonths) || input.reserveMonths < 0 || input.reserveMonths > 24) return { ok: false, error: "Months of reserve must be a whole number from 0 to 24." };
  if (input.reserveOverride !== null && (!Number.isFinite(input.reserveOverride) || input.reserveOverride < 0)) return { ok: false, error: "The reserve amount cannot be negative." };
  if (input.defaultCollectionDays !== null && (!Number.isInteger(input.defaultCollectionDays) || input.defaultCollectionDays < 0 || input.defaultCollectionDays > 365)) return { ok: false, error: "Days to collect must be a whole number from 0 to 365." };

  const values = { reserveMonths: input.reserveMonths, reserveOverride: input.reserveOverride === null ? null : input.reserveOverride.toFixed(2), defaultCollectionDays: input.defaultCollectionDays };
  await db
    .insert(planningSettings)
    .values({ tenantId: session.tenantId, ...values })
    .onConflictDoUpdate({ target: planningSettings.tenantId, set: values });
  revalidatePath("/dashboard/forecast");
  return { ok: true };
}
