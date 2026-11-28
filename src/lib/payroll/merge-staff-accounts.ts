import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, employees, journalEntries, journalLines, staffAccountMoves } from "@/db/schema";
import { getOrCreateStaffAccountId, staffBalances } from "./staff-account";

// Moves the history of each employee's old advance account onto their one staff account. Dates, amounts, vouchers and descriptions stay as they are: only the
// account on the line changes. Every moved line is recorded (staff_account_moves) so the move can be undone. It can safely be run again: lines already moved are
// no longer on the old account. The whole move for an organization is one transaction, rolled back if any employee's balance would come out different.

const round2 = (n: number) => Math.round(n * 100) / 100 + 0;
const OLD_GROUP_NAME = "Salary Payable";
const NEW_GROUP_NAME = "Staff accounts";

export type MergeRow = {
  employeeId: string;
  code: string;
  name: string;
  /** Positive: the company owes the employee. Negative: the employee owes the company. */
  salaryAccount: number;
  advanceAccount: number;
  combined: number;
  lines: number;
};

export type MergePlan = {
  rows: MergeRow[];
  lines: number;
  /** Total assets and total liabilities both fall by this much: the advances stop being shown as an asset and are taken off the staff accounts instead. */
  totalsFallBy: number;
  /** Postings under Staff Advances that belong to no employee, which stay where they are. */
  leftOver: { code: string; name: string; net: number }[];
};

async function netByAccount(tenantId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { net: number; lines: number }>();
  const rows = await db
    .select({ accountId: journalLines.accountId, net: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)`, lines: sql<number>`count(*)::int` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, ids)))
    .groupBy(journalLines.accountId);
  return new Map(rows.map((r) => [r.accountId, { net: round2(Number(r.net)), lines: r.lines }]));
}

const peopleToMerge = async (tenantId: string) =>
  (await db.select().from(employees).where(eq(employees.tenantId, tenantId))).filter((e) => e.advanceAccountId && e.advanceAccountId !== e.payableAccountId);

const staffAdvanceGroup = async (tenantId: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, "1360"))).limit(1))[0] ?? null;

/** What the move would do, without changing anything. */
export async function planStaffAccountMerge(tenantId: string): Promise<MergePlan> {
  const people = await peopleToMerge(tenantId);
  const nets = await netByAccount(tenantId, people.flatMap((e) => [e.payableAccountId, e.advanceAccountId]).filter((a): a is string => Boolean(a)));
  const rows = people
    .map((e) => {
      const salary = nets.get(e.payableAccountId ?? "")?.net ?? 0;
      const advance = nets.get(e.advanceAccountId!)?.net ?? 0;
      return { employeeId: e.id, code: e.employeeCode, name: e.fullName, salaryAccount: salary, advanceAccount: advance, combined: round2(salary + advance), lines: nets.get(e.advanceAccountId!)?.lines ?? 0 };
    })
    .filter((r) => r.lines > 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const group = await staffAdvanceGroup(tenantId);
  const others = group
    ? await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), or(eq(accounts.id, group.id), eq(accounts.parentAccountId, group.id))))
    : [];
  const owned = new Set(people.map((e) => e.advanceAccountId));
  const strays = others.filter((a) => !owned.has(a.id));
  const strayNets = await netByAccount(tenantId, strays.map((a) => a.id));
  const leftOver = strays.map((a) => ({ code: a.code, name: a.name, net: strayNets.get(a.id)?.net ?? 0 })).filter((a) => a.net !== 0);

  return { rows, lines: rows.reduce((s, r) => s + r.lines, 0), totalsFallBy: round2(rows.reduce((s, r) => s - r.advanceAccount, 0)), leftOver };
}

/** Does the move for one organization. Returns what was done. */
export async function mergeStaffAccounts(tenantId: string): Promise<MergePlan> {
  const plan = await planStaffAccountMerge(tenantId);
  const people = await peopleToMerge(tenantId);
  const target = new Map<string, string>();
  for (const e of people) target.set(e.id, e.payableAccountId ?? (await getOrCreateStaffAccountId(tenantId, e.id)));
  const before = await staffBalances(tenantId);
  const group = await staffAdvanceGroup(tenantId);

  await db.transaction(async (tx) => {
    for (const e of people) {
      const from = e.advanceAccountId!;
      const to = target.get(e.id)!;
      const lines = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
        .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, from)));
      if (lines.length > 0) {
        await tx.insert(staffAccountMoves).values(lines.map((l) => ({ tenantId, employeeId: e.id, journalLineId: l.id, fromAccountId: from, toAccountId: to })));
        await tx.update(journalLines).set({ accountId: to }).where(inArray(journalLines.id, lines.map((l) => l.id)));
      }
      await tx.update(accounts).set({ isActive: false }).where(and(eq(accounts.id, from), eq(accounts.tenantId, tenantId)));
    }
    // Staff Advances itself is hidden once nothing under it is left with a balance.
    if (group && plan.leftOver.length === 0) {
      await tx.update(accounts).set({ isActive: false }).where(and(eq(accounts.tenantId, tenantId), or(eq(accounts.id, group.id), eq(accounts.parentAccountId, group.id))));
    }
    await tx.update(accounts).set({ name: NEW_GROUP_NAME }).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, "2300"), eq(accounts.name, OLD_GROUP_NAME), isNull(accounts.parentAccountId)));

    // Checked inside the transaction: every employee's balance must be exactly what it was.
    const accountIds = [...target.values()];
    const after = accountIds.length
      ? await tx
          .select({ accountId: journalLines.accountId, v: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
          .where(and(eq(journalEntries.tenantId, tenantId), inArray(journalLines.accountId, accountIds)))
          .groupBy(journalLines.accountId)
      : [];
    const byAccount = new Map(after.map((r) => [r.accountId, round2(Number(r.v))]));
    for (const e of people) {
      const now = byAccount.get(target.get(e.id)!) ?? 0;
      if (Math.abs(now - (before.get(e.id) ?? 0)) > 0.005) throw new Error(`${e.fullName}'s balance would change from ${before.get(e.id)} to ${now}, so nothing was moved`);
    }
  });

  return plan;
}

/** Puts every moved line back on the account it came from and shows the old accounts again. Entries made after the move stay on the staff accounts. */
export async function undoStaffAccountMerge(tenantId: string): Promise<number> {
  const moves = await db.select().from(staffAccountMoves).where(eq(staffAccountMoves.tenantId, tenantId));
  if (moves.length === 0) return 0;
  const fromIds = [...new Set(moves.map((m) => m.fromAccountId))];
  const group = await staffAdvanceGroup(tenantId);
  await db.transaction(async (tx) => {
    for (const from of fromIds) {
      await tx.update(journalLines).set({ accountId: from }).where(inArray(journalLines.id, moves.filter((m) => m.fromAccountId === from).map((m) => m.journalLineId)));
    }
    await tx.update(accounts).set({ isActive: true }).where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [...fromIds, ...(group ? [group.id] : [])])));
    await tx.update(accounts).set({ name: OLD_GROUP_NAME }).where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, "2300"), eq(accounts.name, NEW_GROUP_NAME), isNull(accounts.parentAccountId)));
    await tx.delete(staffAccountMoves).where(eq(staffAccountMoves.tenantId, tenantId));
  });
  return moves.length;
}
