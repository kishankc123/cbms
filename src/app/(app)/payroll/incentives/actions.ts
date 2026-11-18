"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { can, requireTenantSession } from "@/lib/session";
import {
  createHeading,
  createRound,
  deleteHeading,
  deleteRound,
  getRound,
  IncentiveError,
  saveEntries,
  setRoundStatus,
  updateHeading,
  type HeadingInput,
  type RoundInput,
} from "@/lib/payroll/incentives";
import type { EntryInput } from "@/lib/payroll/incentive-rules";
import { generatePayrollRun } from "../salary-sheet/actions";

// Performance incentives. Every action checks the permission first; the writing is in lib/payroll/incentives.ts.

async function guard(action: "create" | "edit" | "delete") {
  const session = await requireTenantSession();
  if (!can(session, "payroll", action)) throw new Error("Not permitted");
  if (!can(session, "payroll", "view_salary")) throw new Error("Not permitted");
  return session;
}

/** Turns the plain-language errors of the incentives code into the message the person sees. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IncentiveError) throw new Error(e.message);
    throw e;
  }
}

/** The salary sheet of the round's pay month, if one is under way, is worked out again so it takes the change. A finalized one is never touched. */
async function refreshRun(tenantId: string, p: { calendarSystem: string; year: number; month: number }) {
  const [existing] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.calendarSystem, p.calendarSystem), eq(payrollRuns.year, p.year), eq(payrollRuns.month, p.month), ne(payrollRuns.status, "finalized")))
    .limit(1);
  if (existing) {
    await generatePayrollRun({ month: p.month, year: p.year, calendar: p.calendarSystem === "BS" ? "BS" : "AD", employeeIds: [] });
  }
}

function refreshPages(roundId?: string) {
  revalidatePath("/payroll/incentives");
  if (roundId) revalidatePath(`/payroll/incentives/${roundId}`);
  revalidatePath("/payroll/salary-sheet");
  revalidatePath("/chart-of-accounts");
}

export async function createHeadingAction(input: HeadingInput) {
  const session = await guard("create");
  await run(() => createHeading(session.tenantId, session.userId, input));
  refreshPages();
}

export async function updateHeadingAction(input: HeadingInput & { id: string; isActive: boolean }) {
  const session = await guard("edit");
  await run(() => updateHeading(session.tenantId, session.userId, input.id, input));
  refreshPages();
}

export async function deleteHeadingAction(input: { id: string }) {
  const session = await guard("delete");
  await run(() => deleteHeading(session.tenantId, session.userId, input.id));
  refreshPages();
}

export async function createRoundAction(input: RoundInput) {
  const session = await guard("create");
  const round = await run(() => createRound(session.tenantId, session.userId, input));
  refreshPages();
  return round.id;
}

/** Saves the entries; with `approve`, approves the round in the same step. */
export async function saveRoundAction(input: { roundId: string; entries: EntryInput[]; approve?: boolean }) {
  const session = await guard("edit");
  const round = await run(async () => {
    const r = await saveEntries(session.tenantId, session.userId, input.roundId, input.entries);
    if (input.approve) await setRoundStatus(session.tenantId, session.userId, input.roundId, "approved");
    return r;
  });
  const now = await getRound(session.tenantId, input.roundId);
  await refreshRun(session.tenantId, round);
  refreshPages(input.roundId);
  return { status: now.round.status };
}

export async function setRoundStatusAction(input: { roundId: string; status: "draft" | "approved" }) {
  const session = await guard("edit");
  const round = await run(() => setRoundStatus(session.tenantId, session.userId, input.roundId, input.status));
  await refreshRun(session.tenantId, round);
  refreshPages(input.roundId);
}

export async function deleteRoundAction(input: { roundId: string }) {
  const session = await guard("delete");
  const round = await run(() => deleteRound(session.tenantId, session.userId, input.roundId));
  await refreshRun(session.tenantId, round);
  refreshPages();
}
