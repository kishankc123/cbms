import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { confirmMatch, createReconciliation, getReconciliation, manualMatch, previewStatement, rematch, reopen, setFlag, signOff, unmatch } from "./reconcile";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
let vendorId: string;
let supplierAccount: string;
let expenseId: string;
let cashId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const bill = (date: string, ref: string, amount: number) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "purchase", referenceNumber: ref, createdBy: org.userId, lines: [{ accountId: expenseId, debitAmount: amount }, { accountId: supplierAccount, creditAmount: amount }] });
const payment = (date: string, ref: string, amount: number) =>
  postJournalEntry({ tenantId: org.tenantId, entryDate: date, sourceType: "payment", referenceNumber: ref, createdBy: org.userId, lines: [{ accountId: supplierAccount, debitAmount: amount }, { accountId: cashId, creditAmount: amount }] });

const csv = ["Date,Reference,Particulars,Debit,Credit,Balance", "2026-09-03,INV-1042,Sales invoice,,125000,125000", "2026-09-13,RCT-9,Cheque received,50000,,75000", "2026-09-20,INV-1060,Sales invoice,,20000,95000", "2026-09-25,INV-1075,Sales invoice,,40000,135000"].join("\n");
const base64 = Buffer.from(csv, "utf8").toString("base64");
const mapping = { date: "Date", reference: "Reference", description: "Particulars", debit: "Debit", credit: "Credit", balance: "Balance" };

beforeAll(async () => {
  org = await createTempOrg("ZZ Supplier Recon");
  other = await createTempOrg("ZZ Supplier Recon Other");
  [{ id: vendorId }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Himal Traders" }).returning({ id: vendors.id });
  supplierAccount = await getOrCreateSupplierPayableAccountId(org.tenantId, vendorId);
  expenseId = (await acct("5900")).id;
  cashId = (await acct("1000")).id;
  await bill("2026-09-03", "INV-1042", 125000);
  await payment("2026-09-12", "CHQ-311", 50000);
  await bill("2026-09-20", "INV-1060", 20000);
  await payment("2026-09-27", "CHQ-312", 7000);
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

let reconId: string;

describe("reconciling a supplier statement", () => {
  it("reads the file, finds the columns and the way round, and compares the balances", async () => {
    const p = await previewStatement(org.tenantId, { vendorId, from: "2026-09-01", to: "2026-09-30", fileName: "s.csv", base64 });
    expect(p.mapping).toMatchObject(mapping);
    expect(p.orientation).toBe("credit_is_bill");
    expect(p.rowsRead).toBe(4);
    expect(p.theirOpening).toBe(0);
    expect(p.theirClosing).toBe(135000);
    expect(p.ourClosing).toBe(88000);
  });

  it("matches by document number, suggests by amount and date, and leaves the rest as leftovers", async () => {
    const r = await createReconciliation(org.tenantId, org.userId, { vendorId, from: "2026-09-01", to: "2026-09-30", fileName: "s.csv", base64, mapping, orientation: "credit_is_bill" });
    reconId = r.id;
    const d = await getReconciliation(org.tenantId, reconId);
    const kinds = d.groups.map((g) => [g.kind, g.status]).sort();
    expect(kinds).toEqual([["amount_date", "suggested"], ["reference", "confirmed"], ["reference", "confirmed"]]);
    expect(d.theirsOnly.map((l) => l.reference)).toEqual(["INV-1075"]);
    expect(d.oursOnly.map((l) => l.reference)).toEqual(["CHQ-312"]);
    // 88,000 against 135,000: 7,000 only in our books, 40,000 only on their statement
    expect(d.proof).toMatchObject({ difference: -47000, openingDifference: 0, matchedDifference: 0, oursOnly: -7000, theirsOnly: 40000 });
    expect(d.suggested).toBe(1);
    expect(d.unresolved).toBe(2);
  });

  it("can't be signed off while a suggestion waits or a leftover has no reason", async () => {
    await expect(signOff(org.tenantId, org.userId, reconId, "")).rejects.toThrow(/suggested match/);
    const d = await getReconciliation(org.tenantId, reconId);
    await confirmMatch(org.tenantId, org.userId, d.groups.find((g) => g.status === "suggested")!.id);
    await expect(signOff(org.tenantId, org.userId, reconId, "")).rejects.toThrow(/no reason yet/);
  });

  it("recording the missing bill and refreshing matches it; a match can be undone and made by hand", async () => {
    await bill("2026-09-25", "INV-1075", 40000);
    await rematch(org.tenantId, org.userId, reconId);
    let d = await getReconciliation(org.tenantId, reconId);
    expect(d.theirsOnly).toHaveLength(0);
    expect(d.proof).toMatchObject({ difference: -7000 + 0, theirsOnly: 0, oursOnly: -7000 + 40000 - 40000 });

    const m = d.groups.find((g) => g.kind === "reference" && g.theirIds.length === 1 && d.theirs.find((t) => t.id === g.theirIds[0])?.reference === "INV-1075")!;
    await unmatch(org.tenantId, org.userId, m.id);
    d = await getReconciliation(org.tenantId, reconId);
    expect(d.theirsOnly).toHaveLength(1);
    await manualMatch(org.tenantId, org.userId, reconId, [d.theirsOnly[0].id], [d.oursOnly.find((l) => l.reference === "INV-1075")!.id]);
    d = await getReconciliation(org.tenantId, reconId);
    expect(d.theirsOnly).toHaveLength(0);
    expect(d.groups.some((g) => g.kind === "manual" && g.status === "confirmed")).toBe(true);
    // the same line can't be in two matches
    await expect(manualMatch(org.tenantId, org.userId, reconId, [d.theirs[0].id], [d.oursOnly[0].id])).rejects.toThrow(/already in a match|Choose|isn't/);
  });

  it("signs off once every leftover has a reason, then locks, and only reopens on request", async () => {
    let d = await getReconciliation(org.tenantId, reconId);
    expect(d.oursOnly).toHaveLength(1);
    await setFlag(org.tenantId, org.userId, reconId, { entryId: d.oursOnly[0].id }, "timing", "cheque in transit");
    await signOff(org.tenantId, org.userId, reconId, "Q1 done");
    d = await getReconciliation(org.tenantId, reconId);
    expect(d.recon.status).toBe("reconciled");
    await expect(setFlag(org.tenantId, org.userId, reconId, { entryId: d.oursOnly[0].id }, null, "")).rejects.toThrow(/signed off/);
    await reopen(org.tenantId, org.userId, reconId);
    expect((await getReconciliation(org.tenantId, reconId)).recon.status).toBe("draft");
  });

  it("is private to the organization", async () => {
    await expect(getReconciliation(other.tenantId, reconId)).rejects.toThrow(/not found/);
    await expect(previewStatement(other.tenantId, { vendorId, from: "2026-09-01", to: "2026-09-30", fileName: "s.csv", base64 })).rejects.toThrow(/supplier was not found/);
  });
});
