"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { todayIso, validateADDate } from "@/lib/calendar";
import { saveCashCount } from "@/lib/ledger/cash-count";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Saves the cash counted at the end of a day. It does not change the books. */
export async function saveCashCountAction(input: { day: string; accountId: string; notes: Record<string, string>; other: string; remark: string }): Promise<ActionResult> {
  const session = await requireTenantSession();
  if (!can(session, "bank_reconciliation", "edit")) return { ok: false, error: "You don't have permission to record a cash count." };
  if (!validateADDate(input.day) || input.day > todayIso()) return { ok: false, error: "Pick a day that has already started." };
  const other = input.other.trim() === "" ? 0 : Number(input.other);
  const result = await saveCashCount(session.tenantId, session.userId, { day: input.day, accountId: input.accountId, notes: input.notes, other, remark: input.remark });
  if (result.ok) revalidatePath("/reports/daybook");
  return result;
}
