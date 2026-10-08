"use server";

import { revalidatePath } from "next/cache";
import { requireTenantSession, can } from "@/lib/session";
import { loadCatchup, saveCatchup } from "@/lib/compliance/catchup";
import type { StreamKey } from "@/lib/compliance/catchup-rules";

// The catch-up checklist: what was already filed when the organization started using the system. Seeing it needs compliance
// view; saving needs edit.

export async function getCatchup() {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "view")) throw new Error("Not permitted");
  return { canEdit: can(session, "compliance", "edit"), ...(await loadCatchup(session.tenantId)) };
}
export type CatchupData = Awaited<ReturnType<typeof getCatchup>>;

export async function saveCatchupAnswers(answers: Partial<Record<StreamKey, string | null>>) {
  const session = await requireTenantSession();
  if (!can(session, "compliance", "edit")) return { ok: false as const, error: "You don't have permission to change the compliance checklist." };
  const r = await saveCatchup(session.tenantId, session.userId, answers);
  if (r.ok) {
    revalidatePath("/compliance", "layout");
  }
  return r;
}
