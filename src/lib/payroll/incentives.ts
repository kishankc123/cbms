import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRoles, accounts, employees, incentiveEntries, incentiveHeadings, incentiveRounds, journalLines, payrollRuns } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { getOrCreateIncentiveHeadingAccount, renameIncentiveHeadingAccount } from "@/lib/ledger/payroll-accounts";
import { entryProblem, type ApprovedEntry, type EntryInput, type IncentiveFrequency, type IncentiveHeading } from "./incentive-rules";

// Performance incentives (see incentive-rules.ts). Plain server helpers, deliberately not server actions: the actions in payroll/incentives check the permission first.

export class IncentiveError extends Error {}
const fail = (message: string): never => {
  throw new IncentiveError(message);
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");
const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

export type HeadingInput = { name: string; frequency: IncentiveFrequency; taxable: boolean; countsForRetirement: boolean };
export type Period = { calendarSystem: string; year: number; month: number };

// ---------------------------------------------------------------------------------------------------------------- headings

export async function listHeadings(tenantId: string) {
  return db.select().from(incentiveHeadings).where(eq(incentiveHeadings.tenantId, tenantId)).orderBy(asc(incentiveHeadings.name));
}

function checkHeading(input: HeadingInput) {
  const name = cleanName(input.name);
  if (!name) fail("Give the heading a name.");
  if (name.length > 60) fail("The name can be at most 60 characters.");
  if (input.countsForRetirement && !input.taxable) {
    // Allowed (an allowance can be counted for SSF/PF without being taxed); nothing to refuse.
  }
  return name;
}

/** Names are unique whatever the capitals, so "sales incentive" can't sit beside "Sales incentive". */
async function assertNameFree(tenantId: string, name: string, exceptId?: string) {
  const all = await db.select({ id: incentiveHeadings.id, name: incentiveHeadings.name }).from(incentiveHeadings).where(eq(incentiveHeadings.tenantId, tenantId));
  if (all.some((h) => h.id !== exceptId && h.name.toLowerCase() === name.toLowerCase())) fail(`There is already an incentive heading called ${name}.`);
}

export async function createHeading(tenantId: string, userId: string, input: HeadingInput) {
  const name = checkHeading(input);
  await assertNameFree(tenantId, name);
  let heading;
  try {
    [heading] = await db.insert(incentiveHeadings).values({ tenantId, name, frequency: input.frequency, taxable: input.taxable, countsForRetirement: input.countsForRetirement }).returning();
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`There is already an incentive heading called ${name}.`);
    throw e;
  }
  // Its expense account (under Salaries > Performance incentives) is made now, so it shows in the Chart of Accounts from the start.
  const account = await getOrCreateIncentiveHeadingAccount(tenantId, heading.id, name);
  await db.update(incentiveHeadings).set({ accountId: account.id }).where(and(eq(incentiveHeadings.id, heading.id), eq(incentiveHeadings.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "incentive_heading_created", entityType: "incentive_heading", entityId: heading.id, after: { name, frequency: input.frequency } });
  return { ...heading, accountId: account.id };
}

export async function updateHeading(tenantId: string, userId: string, id: string, input: HeadingInput & { isActive: boolean }) {
  const name = checkHeading(input);
  const [current] = await db.select().from(incentiveHeadings).where(and(eq(incentiveHeadings.id, id), eq(incentiveHeadings.tenantId, tenantId))).limit(1);
  if (!current) return fail("That heading was not found.");
  await assertNameFree(tenantId, name, id);
  try {
    // Finished payroll keeps its own figures; this changes the months still to be worked out.
    await db.update(incentiveHeadings).set({ name, frequency: input.frequency, taxable: input.taxable, countsForRetirement: input.countsForRetirement, isActive: input.isActive }).where(and(eq(incentiveHeadings.id, id), eq(incentiveHeadings.tenantId, tenantId)));
  } catch (e) {
    if (isUniqueViolation(e)) return fail(`There is already an incentive heading called ${name}.`);
    throw e;
  }
  await renameIncentiveHeadingAccount(tenantId, id, name);
  await logAuditEvent({ tenantId, userId, action: "incentive_heading_updated", entityType: "incentive_heading", entityId: id, before: { name: current.name }, after: { name } });
}

/** A heading nobody has used goes, with its account; one with rounds can only be switched off. */
export async function deleteHeading(tenantId: string, userId: string, id: string) {
  const [current] = await db.select().from(incentiveHeadings).where(and(eq(incentiveHeadings.id, id), eq(incentiveHeadings.tenantId, tenantId))).limit(1);
  if (!current) return fail("That heading was not found.");
  const [used] = await db.select({ id: incentiveRounds.id }).from(incentiveRounds).where(eq(incentiveRounds.headingId, id)).limit(1);
  if (used) return fail("This heading already has rounds, so it can't be deleted. Switch it off instead, and it can't be used for new rounds.");
  await db.delete(incentiveHeadings).where(and(eq(incentiveHeadings.id, id), eq(incentiveHeadings.tenantId, tenantId)));
  if (current.accountId) {
    const [posted] = await db.select({ n: sql<number>`count(*)::int` }).from(journalLines).where(eq(journalLines.accountId, current.accountId));
    await db.delete(accountRoles).where(and(eq(accountRoles.tenantId, tenantId), eq(accountRoles.accountId, current.accountId)));
    if (!posted.n) await db.delete(accounts).where(and(eq(accounts.id, current.accountId), eq(accounts.tenantId, tenantId))).catch(() => {});
  }
  await logAuditEvent({ tenantId, userId, action: "incentive_heading_deleted", entityType: "incentive_heading", entityId: id, before: { name: current.name } });
}

// ------------------------------------------------------------------------------------------------------------------ rounds

/** A round is locked once the payroll run of its pay month is finalized: what it paid is on the ledger. */
export async function isPeriodFinalized(tenantId: string, p: Period): Promise<boolean> {
  const [run] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.calendarSystem, p.calendarSystem), eq(payrollRuns.year, p.year), eq(payrollRuns.month, p.month), eq(payrollRuns.status, "finalized")))
    .limit(1);
  return Boolean(run);
}

async function loadRound(tenantId: string, roundId: string) {
  const [round] = await db.select().from(incentiveRounds).where(and(eq(incentiveRounds.id, roundId), eq(incentiveRounds.tenantId, tenantId))).limit(1);
  if (!round) return fail("That round was not found.");
  return round!;
}

async function assertOpen(tenantId: string, round: { calendarSystem: string; year: number; month: number }) {
  if (await isPeriodFinalized(tenantId, round)) fail("The payroll for this month is finalized, so this round can't be changed. Reverse the payroll run first if it must be.");
}

export type RoundInput = { headingId: string; calendarSystem: string; year: number; month: number; periodLabel: string; note: string };

export async function createRound(tenantId: string, userId: string, input: RoundInput) {
  const label = cleanName(input.periodLabel);
  if (!label) fail("Say what the round is for, for example Quarter 1 2083.");
  if (!Number.isInteger(input.year) || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) fail("Choose the month it is paid with.");
  const [heading] = await db.select().from(incentiveHeadings).where(and(eq(incentiveHeadings.id, input.headingId), eq(incentiveHeadings.tenantId, tenantId))).limit(1);
  if (!heading) return fail("Choose an incentive heading.");
  if (!heading!.isActive) fail(`${heading!.name} is switched off. Switch it on to add rounds.`);
  await assertOpen(tenantId, input);
  const same = await db.select({ label: incentiveRounds.periodLabel }).from(incentiveRounds).where(and(eq(incentiveRounds.tenantId, tenantId), eq(incentiveRounds.headingId, input.headingId)));
  if (same.some((r) => r.label.toLowerCase() === label.toLowerCase())) fail(`${heading!.name} already has a round for ${label}. Open that one instead.`);
  const [round] = await db
    .insert(incentiveRounds)
    .values({ tenantId, headingId: input.headingId, calendarSystem: input.calendarSystem, year: input.year, month: input.month, periodLabel: label, note: input.note.trim() || null, createdBy: userId })
    .returning();
  await logAuditEvent({ tenantId, userId, action: "incentive_round_created", entityType: "incentive_round", entityId: round.id, after: { heading: heading!.name, label } });
  return round;
}

export async function listRounds(tenantId: string) {
  const rows = await db
    .select({
      round: incentiveRounds,
      headingName: incentiveHeadings.name,
      total: sql<string>`coalesce((select sum(${incentiveEntries.amount}) from ${incentiveEntries} where ${incentiveEntries.roundId} = ${incentiveRounds.id}), 0)`,
      people: sql<number>`(select count(distinct ${incentiveEntries.employeeId}) from ${incentiveEntries} where ${incentiveEntries.roundId} = ${incentiveRounds.id})::int`,
    })
    .from(incentiveRounds)
    .innerJoin(incentiveHeadings, eq(incentiveHeadings.id, incentiveRounds.headingId))
    .where(eq(incentiveRounds.tenantId, tenantId))
    .orderBy(desc(incentiveRounds.year), desc(incentiveRounds.month), asc(incentiveHeadings.name));
  return rows.map((r) => ({ ...r.round, headingName: r.headingName, total: Number(r.total), people: r.people }));
}

export async function getRound(tenantId: string, roundId: string) {
  const round = await loadRound(tenantId, roundId);
  const [heading] = await db.select().from(incentiveHeadings).where(and(eq(incentiveHeadings.id, round.headingId), eq(incentiveHeadings.tenantId, tenantId))).limit(1);
  const entries = await db
    .select({ id: incentiveEntries.id, employeeId: incentiveEntries.employeeId, employeeName: employees.fullName, employeeCode: employees.employeeCode, amount: incentiveEntries.amount, note: incentiveEntries.note })
    .from(incentiveEntries)
    .innerJoin(employees, eq(employees.id, incentiveEntries.employeeId))
    .where(eq(incentiveEntries.roundId, roundId))
    .orderBy(asc(employees.fullName), asc(incentiveEntries.createdAt));
  return { round, heading, entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })), locked: await isPeriodFinalized(tenantId, round) };
}

/** Replaces the round's entries with these. Allowed while the payroll for the month is not finalized, whether the round is a draft or approved. */
export async function saveEntries(tenantId: string, userId: string, roundId: string, entries: EntryInput[]) {
  const round = await loadRound(tenantId, roundId);
  await assertOpen(tenantId, round);
  const filled = entries.filter((e) => e.employeeId || e.amount);
  const problem = entryProblem(filled);
  if (problem) fail(problem);
  const ids = [...new Set(filled.map((e) => e.employeeId))];
  if (ids.length > 0) {
    const real = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tenantId), inArray(employees.id, ids)));
    if (real.length !== ids.length) fail("One of the employees was not found.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(incentiveEntries).where(eq(incentiveEntries.roundId, roundId));
    if (filled.length > 0) await tx.insert(incentiveEntries).values(filled.map((e) => ({ tenantId, roundId, employeeId: e.employeeId, amount: round2(e.amount).toFixed(2), note: e.note.trim() || null })));
  });
  await logAuditEvent({ tenantId, userId, action: "incentive_entries_saved", entityType: "incentive_round", entityId: roundId, after: { entries: filled.length, total: round2(filled.reduce((s, e) => s + e.amount, 0)) } });
  return round;
}

export async function setRoundStatus(tenantId: string, userId: string, roundId: string, status: "draft" | "approved") {
  const round = await loadRound(tenantId, roundId);
  await assertOpen(tenantId, round);
  if (status === "approved") {
    const [any] = await db.select({ id: incentiveEntries.id }).from(incentiveEntries).where(eq(incentiveEntries.roundId, roundId)).limit(1);
    if (!any) fail("Add at least one employee before approving the round.");
  }
  await db
    .update(incentiveRounds)
    .set(status === "approved" ? { status, approvedBy: userId, approvedAt: new Date() } : { status, approvedBy: null, approvedAt: null })
    .where(and(eq(incentiveRounds.id, roundId), eq(incentiveRounds.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: status === "approved" ? "incentive_round_approved" : "incentive_round_reopened", entityType: "incentive_round", entityId: roundId });
  return round;
}

/** Only a round that has not been paid can go; its entries go with it. */
export async function deleteRound(tenantId: string, userId: string, roundId: string) {
  const round = await loadRound(tenantId, roundId);
  await assertOpen(tenantId, round);
  await db.delete(incentiveRounds).where(and(eq(incentiveRounds.id, roundId), eq(incentiveRounds.tenantId, tenantId)));
  await logAuditEvent({ tenantId, userId, action: "incentive_round_deleted", entityType: "incentive_round", entityId: roundId, before: { label: round.periodLabel } });
  return round;
}

// ------------------------------------------------------------------------------------------------------------- the pay month

export type MonthIncentives = { headings: IncentiveHeading[]; entries: ApprovedEntry[] };

/** What the salary sheet of a pay month pays: the entries of every approved round of that month, with the headings they are under. */
export async function approvedIncentivesFor(tenantId: string, p: Period): Promise<MonthIncentives> {
  const rows = await db
    .select({ employeeId: incentiveEntries.employeeId, headingId: incentiveRounds.headingId, amount: incentiveEntries.amount })
    .from(incentiveEntries)
    .innerJoin(incentiveRounds, eq(incentiveRounds.id, incentiveEntries.roundId))
    .where(and(eq(incentiveRounds.tenantId, tenantId), eq(incentiveRounds.status, "approved"), eq(incentiveRounds.calendarSystem, p.calendarSystem), eq(incentiveRounds.year, p.year), eq(incentiveRounds.month, p.month)));
  const headingIds = [...new Set(rows.map((r) => r.headingId))];
  const headings = headingIds.length === 0 ? [] : await db.select().from(incentiveHeadings).where(and(eq(incentiveHeadings.tenantId, tenantId), inArray(incentiveHeadings.id, headingIds)));
  return {
    headings: headings.map((h) => ({ id: h.id, name: h.name, taxable: h.taxable, countsForRetirement: h.countsForRetirement })),
    entries: rows.map((r) => ({ employeeId: r.employeeId, headingId: r.headingId, amount: Number(r.amount) })),
  };
}

/** The rounds of a pay month, for the salary sheet: what is paid and what is still waiting for approval. */
export async function roundsForMonth(tenantId: string, p: Period) {
  const all = await listRounds(tenantId);
  return all.filter((r) => r.calendarSystem === p.calendarSystem && r.year === p.year && r.month === p.month);
}
