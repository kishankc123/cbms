import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { accounts, journalEntries } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { getJournalEntry, listJournal } from "@/lib/ledger/journal-list";

// The Entries list shows what was typed in on the Journal Entries screen, and only those entries can be reversed there: reversing a sale's or a payment's
// entry would leave the document and the books saying different things.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));
const { createManualJournalEntry, reverseEntry, exportEntriesAction } = await import("./actions");

let cashId: string;
let salesId: string;
let ownId: string;
let saleId: string;
let systemId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0].id;
const form = (id: string) => {
  const f = new FormData();
  f.append("journalEntryId", id);
  return f;
};
const post = (sourceType: "sale" | "manual", memo: string, amount: number, extra: { sourceId?: string; referenceNumber?: string } = {}) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-10", sourceType, memo, createdBy: org.userId, ...extra, lines: [{ accountId: cashId, debitAmount: amount }, { accountId: salesId, creditAmount: amount }] });

beforeAll(async () => {
  org = await createTempOrg("ZZ Journal List");
  other = await createTempOrg("ZZ Journal List Other");
  cashId = await acct("1000");
  salesId = await acct("4000");
  const mine = await createManualJournalEntry({ entryDate: "2026-09-10", description: "Director paid electricity", lines: [{ accountId: cashId, debitAmount: 4500, creditAmount: 0 }, { accountId: salesId, debitAmount: 0, creditAmount: 4500 }] });
  if (!mine.ok) throw new Error(mine.error);
  ownId = mine.entryId;
  saleId = (await post("sale", "A sale", 700, { sourceId: randomUUID(), referenceNumber: "INV-1" })).id;
  systemId = (await post("manual", "Cash short found at count", 20, { sourceId: randomUUID(), referenceNumber: "CASH-SHORT" })).id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("the journal entries list", () => {
  it("shows only the entries typed in on this screen to begin with, and everything under All sources", async () => {
    const mine = (await listJournal(org.tenantId, {}, { limit: 50 })).rows;
    expect(mine.map((r) => r.id)).toEqual([ownId]);
    expect(mine[0]).toMatchObject({ source: "Manual", own: true, state: "posted", amount: 4500, narration: "Director paid electricity" });
    expect(mine[0].lines).toHaveLength(2);
    expect(mine[0].enteredBy).not.toBe("");
    const all = (await listJournal(org.tenantId, { source: "all" }, { limit: 50 })).rows;
    expect(all.map((r) => r.id).sort()).toEqual([ownId, saleId, systemId].sort());
    expect(all.find((r) => r.id === systemId)).toMatchObject({ source: "Automatic", own: false });
    expect((await listJournal(org.tenantId, { source: "sale" }, { limit: 50 })).rows.map((r) => r.id)).toEqual([saleId]);
  });

  it("finds entries by narration, voucher, amount, account and dates, a page at a time", async () => {
    const ids = async (f: Parameters<typeof listJournal>[1]) => (await listJournal(org.tenantId, { source: "all", ...f }, { limit: 50 })).rows.map((r) => r.id);
    expect(await ids({ q: "electric" })).toEqual([ownId]);
    expect(await ids({ q: "INV-1" })).toEqual([saleId]);
    expect(await ids({ q: "4,500" })).toEqual([ownId]);
    expect(await ids({ q: "%" })).toEqual([]);
    expect(await ids({ accountId: cashId })).toHaveLength(3);
    expect(await ids({ from: "2026-10-01" })).toEqual([]);
    const first = await listJournal(org.tenantId, { source: "all" }, { limit: 2 });
    expect([first.rows.length, first.hasMore]).toEqual([2, true]);
    expect((await listJournal(org.tenantId, { source: "all" }, { limit: 2, offset: 2 })).hasMore).toBe(false);
  });

  it("reads one voucher, and never another organization's", async () => {
    expect((await getJournalEntry(org.tenantId, ownId))?.amount).toBe(4500);
    expect(await getJournalEntry(other.tenantId, ownId)).toBeNull();
    expect(await getJournalEntry(org.tenantId, "not-an-id")).toBeNull();
  });

  it("exports one row for each line, with the debits and credits as numbers", async () => {
    const out = await exportEntriesAction({ source: "manual" });
    expect(out.entries).toBe(1);
    expect(out.rows).toHaveLength(3);
    expect(out.rows.slice(1).map((r) => r[r.length - 3]).filter(Boolean)).toEqual([4500]);
  });
});

describe("reversing from the journal", () => {
  it("is refused for an entry another record made, which stays as it was", async () => {
    for (const id of [saleId, systemId]) {
      await expect(reverseEntry(form(id))).rejects.toThrow(/made by another record/);
      expect((await db.select().from(journalEntries).where(eq(journalEntries.id, id)))[0].isReversed).toBe(false);
    }
  });

  it("works for an entry typed in here, and the reversal can't be reversed again", async () => {
    await reverseEntry(form(ownId));
    const rows = (await listJournal(org.tenantId, {}, { limit: 50 })).rows;
    expect(rows.map((r) => r.state).sort()).toEqual(["reversal", "reversed"]);
    await expect(reverseEntry(form(rows.find((r) => r.state === "reversal")!.id))).rejects.toThrow(/itself a reversal/);
    await expect(reverseEntry(form(ownId))).rejects.toThrow(/already reversed/);
  });
});
