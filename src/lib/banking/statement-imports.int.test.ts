import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankReconciliationMatchLines, bankReconciliationMatches, bankReconciliations, bankStatementImports, bankStatementLines } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { deleteStatementImport, listStatementImports } from "./statement-imports";

// A statement uploaded wrongly can be deleted, and uploaded again, unless a line of it is matched or a signed-off reconciliation covers its dates.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;
let other: Awaited<ReturnType<typeof createTempOrg>>;
let bankId: string;

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
const upload = async (name: string, start: string, end: string, amounts: number[]) => {
  const [imp] = await db.insert(bankStatementImports).values({ tenantId: org.tenantId, bankAccountId: bankId, fileName: name, statementPeriodStart: start, statementPeriodEnd: end, rowCount: amounts.length, status: "confirmed" }).returning();
  const lines = await db
    .insert(bankStatementLines)
    .values(amounts.map((a, i) => ({ tenantId: org.tenantId, bankAccountId: bankId, importId: imp.id, transactionDate: start, description: `row ${i}`, amount: a.toFixed(2), dedupeHash: `${name}-${i}` })))
    .returning();
  return { imp, lines };
};
const lineCount = async () => (await db.select().from(bankStatementLines).where(eq(bankStatementLines.bankAccountId, bankId))).length;

beforeAll(async () => {
  org = await createTempOrg("ZZ Statement Delete");
  other = await createTempOrg("ZZ Statement Delete Other");
  const cash = await acct("1000");
  bankId = (await db.insert(bankAccounts).values({ tenantId: org.tenantId, accountName: "Test Bank", chartOfAccountsLink: cash.id }).returning())[0].id;
});
afterAll(async () => {
  await org.remove();
  await other.remove();
});

describe("deleting an uploaded statement", () => {
  it("removes an unmatched statement and its lines, so it can be uploaded again", async () => {
    const { imp } = await upload("wrong.xlsx", "2026-09-01", "2026-09-30", [500, -200, -50]);
    const listed = (await listStatementImports(org.tenantId, bankId)).find((r) => r.id === imp.id)!;
    expect(listed).toMatchObject({ rows: 3, matched: 0, blockedBecause: null });
    await expect(deleteStatementImport(org.tenantId, org.userId, imp.id)).resolves.toEqual({ removed: 3 });
    expect(await lineCount()).toBe(0);
    expect((await db.select().from(bankStatementImports).where(eq(bankStatementImports.id, imp.id))).length).toBe(0);
  });

  it("refuses while a line is matched to the books, and lets go once it is unmatched", async () => {
    const { imp, lines } = await upload("matched.xlsx", "2026-10-01", "2026-10-31", [1000, -300]);
    const [m] = await db.insert(bankReconciliationMatches).values({ tenantId: org.tenantId, bankAccountId: bankId, matchType: "manual", createdBy: org.userId }).returning();
    await db.insert(bankReconciliationMatchLines).values({ matchId: m.id, statementLineId: lines[0].id, amountApplied: "1000" });
    const listed = (await listStatementImports(org.tenantId, bankId)).find((r) => r.id === imp.id)!;
    expect(listed.matched).toBe(1);
    await expect(deleteStatementImport(org.tenantId, org.userId, imp.id)).rejects.toThrow(/matched to your books/);
    await db.update(bankReconciliationMatches).set({ unmatchedAt: new Date(), unmatchedBy: org.userId }).where(eq(bankReconciliationMatches.id, m.id));
    await expect(deleteStatementImport(org.tenantId, org.userId, imp.id)).resolves.toEqual({ removed: 2 });
  });

  it("refuses while a signed-off reconciliation covers its dates", async () => {
    const { imp } = await upload("signed.xlsx", "2026-11-01", "2026-11-30", [700]);
    const [r] = await db.insert(bankReconciliations).values({ tenantId: org.tenantId, bankAccountId: bankId, periodStart: "2026-11-01", periodEnd: "2026-11-30", statementBalance: "700", ledgerBalance: "700", status: "reconciled" }).returning();
    await expect(deleteStatementImport(org.tenantId, org.userId, imp.id)).rejects.toThrow(/Reopen it first/);
    await db.update(bankReconciliations).set({ status: "reopened" }).where(eq(bankReconciliations.id, r.id));
    await expect(deleteStatementImport(org.tenantId, org.userId, imp.id)).resolves.toEqual({ removed: 1 });
  });

  it("does not touch another organization's statement", async () => {
    const { imp } = await upload("mine.xlsx", "2026-12-01", "2026-12-31", [100]);
    await expect(deleteStatementImport(other.tenantId, other.userId, imp.id)).rejects.toThrow(/not found/);
    expect(await lineCount()).toBe(1);
  });
});
