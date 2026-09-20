import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, auditLog, customers } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { ChartError, createAccountEntry, createSubGroupEntry, deleteAccountEntry, insertChildAccount, listAccountsWithBalances, updateAccountEntry } from "./chart";
import { createSubAccount } from "./control-accounts";
import { postJournalEntry } from "./post";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const byCode = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const rejects = async (p: Promise<unknown>, pattern: RegExp) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(ChartError);
  expect((err as Error).message).toMatch(pattern);
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Chart Test");
});
afterAll(async () => {
  await org.remove();
});

describe("chart of accounts (database)", () => {
  it("never reuses a sub-account code after a delete", async () => {
    const bank = await byCode("1010");
    const a = await createSubAccount(org.tenantId, bank, "Bank A");
    const b = await createSubAccount(org.tenantId, bank, "Bank B");
    const c = await createSubAccount(org.tenantId, bank, "Bank C");
    expect([a.code, b.code, c.code]).toEqual(["1010.01", "1010.02", "1010.03"]);
    await deleteAccountEntry(org.tenantId, org.userId, b.id);
    const d = await createSubAccount(org.tenantId, bank, "Bank D");
    expect(d.code).toBe("1010.04");
  });

  it("gives concurrent creations different codes", async () => {
    const ar = await byCode("1100");
    const made = await Promise.all([1, 2, 3, 4].map((i) => insertChildAccount(org.tenantId, ar, { name: `Parallel ${i}` })));
    expect(new Set(made.map((m) => m.code)).size).toBe(4);
  });

  it("enforces unique codes in the database as well", async () => {
    const bank = await byCode("1010");
    await expect(db.insert(accounts).values({ tenantId: org.tenantId, code: bank.code, name: "Clash", category: "asset" })).rejects.toThrow();
  });

  it("rejects a duplicate or malformed group code with a readable message", async () => {
    await rejects(createAccountEntry(org.tenantId, org.userId, { code: "1000", name: "Again", subCategory: "Current assets" }), /already exists/);
    await rejects(createAccountEntry(org.tenantId, org.userId, { code: "1010.09", name: "Sneaky", subCategory: "Current assets" }), /dot/);
    await rejects(createAccountEntry(org.tenantId, org.userId, { code: "6000", name: "Bad", subCategory: "Nonsense" }), /category/);
    const ok = await createAccountEntry(org.tenantId, org.userId, { code: "6000", name: "Marketing", subCategory: "Variable expenses" });
    expect(ok.category).toBe("expense");
  });

  it("blocks changing the type of an account that has transactions, and allows it before", async () => {
    const acct = await createAccountEntry(org.tenantId, org.userId, { code: "7000", name: "Movable", subCategory: "Variable expenses" });
    const cash = await byCode("1000");
    await updateAccountEntry(org.tenantId, org.userId, { id: acct.id, name: "Movable", isActive: true, subCategory: "Revenue" });
    expect((await byCode("7000")).category).toBe("income");

    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: cash.id, debitAmount: 100 }, { accountId: acct.id, creditAmount: 100 }] });
    await rejects(updateAccountEntry(org.tenantId, org.userId, { id: acct.id, name: "Movable", isActive: true, subCategory: "Variable expenses" }), /transactions/);
    // a presentation-only change within the same type is still fine
    await updateAccountEntry(org.tenantId, org.userId, { id: acct.id, name: "Movable", isActive: true, subCategory: "Revenue" });
  });

  it("cascades a category change to sub-groups", async () => {
    const group = await createAccountEntry(org.tenantId, org.userId, { code: "7100", name: "Group", subCategory: "Fixed expenses" });
    const child = await createSubGroupEntry(org.tenantId, org.userId, { parentAccountId: group.id, name: "Child" });
    await updateAccountEntry(org.tenantId, org.userId, { id: group.id, name: "Group", isActive: true, subCategory: "Revenue" });
    const after = (await db.select().from(accounts).where(eq(accounts.id, child.id)))[0];
    expect(after.category).toBe("income");
    expect(after.subCategory).toBe("Revenue");
  });

  it("protects system accounts", async () => {
    const vat = await byCode("2100");
    await rejects(deleteAccountEntry(org.tenantId, org.userId, vat.id), /system account/);
    await rejects(updateAccountEntry(org.tenantId, org.userId, { id: vat.id, name: vat.name, isActive: false }), /system account/);
    await rejects(updateAccountEntry(org.tenantId, org.userId, { id: vat.id, name: vat.name, isActive: true, subCategory: "Revenue" }), /system account/);
    // renaming is allowed
    await updateAccountEntry(org.tenantId, org.userId, { id: vat.id, name: "VAT Payable", isActive: true });
    expect((await byCode("2100")).name).toBe("VAT Payable");
  });

  it("explains why an account in use can't be deleted", async () => {
    const ar = await byCode("1100");
    const sub = await createSubAccount(org.tenantId, ar, "Cust Y");
    await db.insert(customers).values({ tenantId: org.tenantId, name: "Cust Y", receivableAccountId: sub.id });
    await rejects(deleteAccountEntry(org.tenantId, org.userId, sub.id), /in use/);
    await rejects(deleteAccountEntry(org.tenantId, org.userId, ar.id), /system account/);

    const group = await createAccountEntry(org.tenantId, org.userId, { code: "7200", name: "HasKids", subCategory: "Fixed expenses" });
    await createSubGroupEntry(org.tenantId, org.userId, { parentAccountId: group.id, name: "Kid" });
    await rejects(deleteAccountEntry(org.tenantId, org.userId, group.id), /sub-groups/);

    const cash = await byCode("1000");
    const used = await createAccountEntry(org.tenantId, org.userId, { code: "7300", name: "Used", subCategory: "Fixed expenses" });
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: used.id, debitAmount: 5 }, { accountId: cash.id, creditAmount: 5 }] });
    await rejects(deleteAccountEntry(org.tenantId, org.userId, used.id), /transaction history/);
  });

  it("only deactivates accounts that are settled, and keeps the hierarchy consistent", async () => {
    const group = await createAccountEntry(org.tenantId, org.userId, { code: "7400", name: "Grp", subCategory: "Fixed expenses" });
    const child = await createSubGroupEntry(org.tenantId, org.userId, { parentAccountId: group.id, name: "Kid" });
    await rejects(updateAccountEntry(org.tenantId, org.userId, { id: group.id, name: "Grp", isActive: false }), /sub-groups first/);
    await updateAccountEntry(org.tenantId, org.userId, { id: child.id, name: "Kid", isActive: false });
    await updateAccountEntry(org.tenantId, org.userId, { id: group.id, name: "Grp", isActive: false });
    await rejects(updateAccountEntry(org.tenantId, org.userId, { id: child.id, name: "Kid", isActive: true }), /group above/);

    const cash = await byCode("1000");
    const owing = await createAccountEntry(org.tenantId, org.userId, { code: "7500", name: "Owing", subCategory: "Fixed expenses" });
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: owing.id, debitAmount: 40 }, { accountId: cash.id, creditAmount: 40 }] });
    await rejects(updateAccountEntry(org.tenantId, org.userId, { id: owing.id, name: "Owing", isActive: false }), /balance/);
  });

  it("shows balances signed to the normal side and rolled up to the group", async () => {
    const group = await createAccountEntry(org.tenantId, org.userId, { code: "8000", name: "Assets group", subCategory: "Current assets" });
    const kid = await createSubGroupEntry(org.tenantId, org.userId, { parentAccountId: group.id, name: "Kid" });
    const equity = await byCode("3000");
    await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-09-01", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: kid.id, debitAmount: 250 }, { accountId: equity.id, creditAmount: 250 }] });
    const rows = await listAccountsWithBalances(org.tenantId);
    const g = rows.find((r) => r.id === group.id)!;
    const k = rows.find((r) => r.id === kid.id)!;
    const e = rows.find((r) => r.id === equity.id)!;
    expect(k.own).toBe(250);
    expect(g.own).toBe(0);
    expect(g.total).toBe(250);
    expect(e.own).toBe(250); // equity is credit-normal, so a credit shows positive
  });

  it("records who changed the chart and what", async () => {
    const acct = await createAccountEntry(org.tenantId, org.userId, { code: "8100", name: "Audited", subCategory: "Fixed expenses" });
    await updateAccountEntry(org.tenantId, org.userId, { id: acct.id, name: "Audited (renamed)", isActive: true });
    await deleteAccountEntry(org.tenantId, org.userId, acct.id);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.tenantId, org.tenantId), eq(auditLog.entityId, acct.id)));
    expect(rows.map((r) => r.action).sort()).toEqual(["account_created", "account_deleted", "account_updated"]);
    const updated = rows.find((r) => r.action === "account_updated")!;
    expect(updated.beforeValue).toMatchObject({ name: "Audited" });
    expect(updated.afterValue).toMatchObject({ name: "Audited (renamed)" });
  });
});
