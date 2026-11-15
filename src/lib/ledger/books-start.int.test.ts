import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, inventorySettings, journalEntries, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry, reverseJournalEntry } from "./post";
import { getInventorySettings } from "@/lib/inventory/stock";
import { setOpeningDate as setInventoryOpeningDate } from "@/lib/inventory/opening";
import { assertNotBeforeBooksStart, changeBooksStartDate, clampToBooksStart, getBooksStart } from "./books-start";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let acct: Record<string, string>;

const post = (entryDate: string, sourceType: Parameters<typeof postJournalEntry>[0]["sourceType"], amount = 100) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate, sourceType, sourceId: randomUUID(), createdBy: org.userId, lines: [{ accountId: acct["1000"], debitAmount: amount }, { accountId: acct["3000"], creditAmount: amount }] });
const setStart = (date: string | null) => db.update(tenants).set({ openingBalanceDate: date }).where(eq(tenants.id, org.tenantId));
const datesOf = async (sourceType: string) => (await db.select({ d: journalEntries.entryDate }).from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, sourceType as "manual")))).map((r) => r.d).sort();

beforeAll(async () => {
  org = await createTempOrg("ZZ Books Start");
  const rows = await db.select().from(accounts).where(eq(accounts.tenantId, org.tenantId));
  acct = Object.fromEntries(rows.map((a) => [a.code, a.id]));
});
afterAll(async () => {
  await org.remove();
});

describe("nothing is dated before the books start", () => {
  it("has no floor until a books start date is set", async () => {
    await setStart(null);
    await expect(post("2020-01-05", "manual")).resolves.toBeTruthy();
    await expect(assertNotBeforeBooksStart(org.tenantId, "2000-01-01")).resolves.toBeUndefined();
  });

  it("refuses an entry before it in plain words, accepts one on or after it, and always accepts an opening balance", async () => {
    await setStart("2026-10-02");
    await expect(post("2026-10-01", "manual")).rejects.toThrow(/before your books start/);
    await expect(post("2026-10-02", "manual")).resolves.toBeTruthy();
    await expect(post("2026-12-01", "manual")).resolves.toBeTruthy();
    await expect(post("2026-10-02", "opening_balance")).resolves.toBeTruthy();
  });

  it("still lets an older entry be undone", async () => {
    await setStart(null);
    const old = await post("2026-01-10", "manual");
    await setStart("2026-10-02");
    await expect(reverseJournalEntry(org.tenantId, old.id, org.userId, "Correction")).resolves.toBeTruthy();
  });
});

describe("changing the books start date", () => {
  it("records a first date without moving anything that is already dated on it", async () => {
    await setStart(null);
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, org.tenantId));
    await post("2026-07-17", "opening_balance");
    expect(await changeBooksStartDate(org.tenantId, org.userId, "2026-07-17")).toEqual({ moved: 0 });
    expect((await getBooksStart(org.tenantId)).date).toBe("2026-07-17");
  });

  it("moves every opening balance with the date, and records who and when", async () => {
    await post("2026-07-17", "opening_balance", 250);
    const result = await changeBooksStartDate(org.tenantId, org.userId, "2026-07-10");
    expect(result.moved).toBe(2);
    expect(await datesOf("opening_balance")).toEqual(["2026-07-10", "2026-07-10"]);
    expect((await getBooksStart(org.tenantId)).date).toBe("2026-07-10");
  });

  it("refuses to start the books after one of their own transactions", async () => {
    await post("2026-08-01", "manual");
    await expect(changeBooksStartDate(org.tenantId, org.userId, "2026-09-01")).rejects.toThrow(/can't start after their own transactions/);
    expect((await getBooksStart(org.tenantId)).date).toBe("2026-07-10");
    expect(await datesOf("opening_balance")).toEqual(["2026-07-10", "2026-07-10"]);
  });

  it("allows moving earlier or to the day of the first transaction", async () => {
    expect((await changeBooksStartDate(org.tenantId, org.userId, "2026-08-01")).moved).toBe(2);
    expect(await datesOf("opening_balance")).toEqual(["2026-08-01", "2026-08-01"]);
  });

  it("refuses a date that is not a date", async () => {
    await expect(changeBooksStartDate(org.tenantId, org.userId, "soon")).rejects.toThrow(/Choose the books start date/);
  });
});

describe("reports start at the books start date", () => {
  it("cuts a range that begins before it, leaves the others alone, and says when a range ends before it", () => {
    expect(clampToBooksStart({ from: "2026-07-17", to: "2027-07-16" }, "2026-10-02")).toEqual({ from: "2026-10-02", to: "2027-07-16", clamped: true, beforeBooks: false });
    expect(clampToBooksStart({ from: "2026-11-01", to: "2027-07-16" }, "2026-10-02")).toEqual({ from: "2026-11-01", to: "2027-07-16", clamped: false, beforeBooks: false });
    expect(clampToBooksStart({ from: "2026-07-17", to: "2026-09-30" }, "2026-10-02")).toEqual({ from: "2026-07-17", to: "2026-09-30", clamped: false, beforeBooks: true });
    expect(clampToBooksStart({ from: "2026-07-17", to: "2027-07-16" }, null)).toEqual({ from: "2026-07-17", to: "2027-07-16", clamped: false, beforeBooks: false });
  });
});

describe("the Inventory Opening Date follows the books start date", () => {
  it("is the books start date when the inventory has no date of its own, and cannot be changed on its own", async () => {
    await db.delete(inventorySettings).where(eq(inventorySettings.tenantId, org.tenantId));
    await setStart("2026-08-01");
    expect(await getInventorySettings(org.tenantId)).toMatchObject({ openingDate: "2026-08-01", followsBooksStart: true });
    await expect(setInventoryOpeningDate(org.tenantId, org.userId, { date: "2026-08-05", confirmed: true })).rejects.toThrow(/follows your books start date/);
  });

  it("keeps a date of its own that was set to a different day before, and says the books start elsewhere", async () => {
    await db.insert(inventorySettings).values({ tenantId: org.tenantId, openingDate: "2026-07-01" }).onConflictDoUpdate({ target: inventorySettings.tenantId, set: { openingDate: "2026-07-01" } });
    expect(await getInventorySettings(org.tenantId)).toMatchObject({ openingDate: "2026-07-01", followsBooksStart: false, booksStartDate: "2026-08-01" });
  });

  it("follows again once the two dates are the same, and is its own date while no books start date is set", async () => {
    await db.update(inventorySettings).set({ openingDate: "2026-08-01" }).where(eq(inventorySettings.tenantId, org.tenantId));
    expect((await getInventorySettings(org.tenantId)).followsBooksStart).toBe(true);
    await setStart(null);
    expect(await getInventorySettings(org.tenantId)).toMatchObject({ openingDate: "2026-08-01", followsBooksStart: false });
  });
});
