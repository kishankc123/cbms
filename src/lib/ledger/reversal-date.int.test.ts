import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, accounts, auditLog, journalEntries, journalLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { todayIso, addDays } from "@/lib/calendar";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { redateReversals } from "./redate-reversals";
import { undoRedatedReversals } from "./undo-redate";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let receivable: string;
let revenue: string;
const earlier = addDays(todayIso(), -75); // well inside an earlier month
const sale = async (date: string, amount = 1000) => postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "manual", createdBy: org.userId, lines: [{ accountId: receivable, debitAmount: amount }, { accountId: revenue, creditAmount: amount }] });
const revenueOn = async (from: string, to: string) => {
  const [r] = await db.select({ net: sql<string>`coalesce(sum(${journalLines.creditAmount} - ${journalLines.debitAmount}), 0)` }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId)).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, revenue), sql`${journalEntries.entryDate} between ${from} and ${to}`));
  return Number(r.net);
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Reversal date");
  const rows = await db.select().from(accounts).where(eq(accounts.tenantId, org.tenantId));
  revenue = rows.find((a) => a.code === "4000")!.id;
  receivable = rows.find((a) => a.category === "asset" && a.isActive)!.id;
});
afterAll(async () => {
  await org.remove();
});

describe("the date of an undo entry", () => {
  it("is the date of the entry it undoes, so an old sale and its undo net out in the same month and today's month is untouched", async () => {
    const original = await sale(earlier);
    const reversal = await reverseJournalEntry(org.tenantId, original.id, org.userId, "Edit of invoice X");
    expect(reversal.entryDate).toBe(earlier);
    expect(await revenueOn(earlier, earlier)).toBe(0);
    expect(await revenueOn(addDays(todayIso(), -3), todayIso())).toBe(0); // nothing taken from this month
  });

  it("is today when the original's month is closed", async () => {
    const date = addDays(todayIso(), -200);
    const original = await sale(date);
    await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: date.slice(0, 8) + "01", periodEnd: addDays(date, 15), label: "Closed test month", status: "closed" }); // stays closed for the rest of this file
    const reversal = await reverseJournalEntry(org.tenantId, original.id, org.userId, "Void");
    expect(reversal.entryDate).toBe(todayIso());
  });

  it("is still today for an entry made today", async () => {
    const original = await sale(todayIso());
    expect((await reverseJournalEntry(org.tenantId, original.id, org.userId)).entryDate).toBe(todayIso());
  });
});

describe("bringing earlier undo entries in line", () => {
  it("moves an undo dated the day of the edit to the original's date, records it, and leaves a closed month alone", async () => {
    const date = addDays(todayIso(), -120);
    const thisMonthBefore = await revenueOn(addDays(todayIso(), -3), todayIso());
    const original = await sale(date, 700);
    const reversal = await reverseJournalEntry(org.tenantId, original.id, org.userId, "Edit");
    // make it look the old way: the undo dated today
    await db.update(journalEntries).set({ entryDate: todayIso() }).where(eq(journalEntries.id, reversal.id));
    expect(await revenueOn(addDays(todayIso(), -3), todayIso())).toBe(thisMonthBefore - 700);

    const preview = await redateReversals({ tenantId: org.tenantId, apply: false });
    expect(preview.moved.map((m) => m.entryId)).toContain(reversal.id);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.id, reversal.id)))[0].entryDate).toBe(todayIso()); // preview changes nothing

    const applied = await redateReversals({ tenantId: org.tenantId, apply: true, userId: org.userId });
    expect(applied.moved.map((m) => m.entryId)).toContain(reversal.id);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.id, reversal.id)))[0].entryDate).toBe(date);
    expect(await revenueOn(addDays(todayIso(), -3), todayIso())).toBe(thisMonthBefore);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.action, "reversal_redated"), inArray(auditLog.entityId, [reversal.id])));
    expect(audit).toHaveLength(1);
    // run again: nothing left to move
    expect((await redateReversals({ tenantId: org.tenantId, apply: true })).moved.map((m) => m.entryId)).not.toContain(reversal.id);
  });

  it("leaves one alone when the month it would move to is closed", async () => {
    const date = addDays(todayIso(), -300);
    const original = await sale(date, 300);
    const reversal = await reverseJournalEntry(org.tenantId, original.id, org.userId, "Edit");
    await db.update(journalEntries).set({ entryDate: todayIso() }).where(eq(journalEntries.id, reversal.id));
    const [period] = await db.insert(accountingPeriods).values({ tenantId: org.tenantId, periodStart: addDays(date, -5), periodEnd: addDays(date, 5), label: "Closed", status: "closed" }).returning({ id: accountingPeriods.id });
    const r = await redateReversals({ tenantId: org.tenantId, apply: true });
    expect(r.skipped.find((s) => s.entryId === reversal.id)?.reason).toMatch(/closed or reconciled/);
    expect((await db.select().from(journalEntries).where(eq(journalEntries.id, reversal.id)))[0].entryDate).toBe(todayIso());
    await db.delete(accountingPeriods).where(eq(accountingPeriods.id, period.id));
  });
});

describe("undoing the re-dating", () => {
  const dateOf = async (id: string) => (await db.select().from(journalEntries).where(eq(journalEntries.id, id)))[0].entryDate;
  const oldStyle = async (daysBack: number) => {
    const date = addDays(todayIso(), -daysBack);
    const original = await sale(date, 100);
    const reversal = await reverseJournalEntry(org.tenantId, original.id, org.userId, "Edit");
    await db.update(journalEntries).set({ entryDate: todayIso() }).where(eq(journalEntries.id, reversal.id)); // dated the day of the edit, the old way
    return { date, reversal };
  };

  it("puts an entry back to the date it had before, from the audit log, and says so in the audit log", async () => {
    const { date, reversal } = await oldStyle(100);
    await redateReversals({ tenantId: org.tenantId, apply: true, userId: org.userId });
    expect(await dateOf(reversal.id)).toBe(date);

    const preview = await undoRedatedReversals({ tenantId: org.tenantId, apply: false });
    expect(preview.restored.find((r) => r.entryId === reversal.id)).toMatchObject({ from: date, to: todayIso() });
    expect(await dateOf(reversal.id)).toBe(date); // preview changes nothing

    await undoRedatedReversals({ tenantId: org.tenantId, apply: true, userId: org.userId });
    expect(await dateOf(reversal.id)).toBe(todayIso());
    const logged = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.action, "reversal_redate_undone"), eq(auditLog.entityId, reversal.id)));
    expect(logged).toHaveLength(1);
    // run again: nothing left to restore for it
    const again = await undoRedatedReversals({ tenantId: org.tenantId, apply: false });
    expect(again.restored.some((r) => r.entryId === reversal.id)).toBe(false);
  });

  it("leaves an entry alone when its date was changed after the re-dating", async () => {
    const { reversal } = await oldStyle(110);
    await redateReversals({ tenantId: org.tenantId, apply: true, userId: org.userId });
    const changed = addDays(todayIso(), -50);
    await db.update(journalEntries).set({ entryDate: changed }).where(eq(journalEntries.id, reversal.id));
    const r = await undoRedatedReversals({ tenantId: org.tenantId, apply: true });
    expect(r.restored.some((x) => x.entryId === reversal.id)).toBe(false);
    expect(r.skipped.find((x) => x.entryId === reversal.id)?.reason).toMatch(/changed since/);
    expect(await dateOf(reversal.id)).toBe(changed);
  });
});
