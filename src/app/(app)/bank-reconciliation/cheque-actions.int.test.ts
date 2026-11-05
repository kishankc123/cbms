import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankAccounts, bankStatementLines, customers, issuedCheques, payments, receivedCheques, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { postJournalEntry } from "@/lib/ledger/post";
import { todayIso } from "@/lib/calendar";
import { issueCheque } from "@/lib/cheques/cheques";
import { depositReceived, receiveCheque } from "@/lib/cheques/received";
import { matchChequeToLine } from "@/lib/cheques/reconcile";
import { cashBalanceAsOf } from "@/lib/dashboard/cash-flow";

// A bank line that proves a cheque cleared records the cheque's payment and matches it to the line in one step.

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let org: Awaited<ReturnType<typeof createTempOrg>>;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireTenantSession: async () => ({ userId: org.userId, tenantId: org.tenantId, role: "owner", permissions: {}, calendar: "AD" }),
  can: () => true,
}));

const A = await import("./actions");
const C = await import("./cheque-actions");

const today = todayIso();
const ago = (n: number) => new Date(Date.parse(today + "T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
let bankLedgerId: string;
let bankId: string;
let vendorId: string;
let customerId: string;

const csv = (rows: string[]) => Buffer.from(["Date,Description,Amount", ...rows].join("\n")).toString("base64");
const importRows = (rows: string[]) => A.confirmStatementImport({ bankAccountId: bankId, fileName: "stmt.csv", base64: csv(rows), mapping: { date: "Date", description: "Description", amount: "Amount" }, saveAsTemplateName: "" });
const lineOf = async (description: string) => (await db.select().from(bankStatementLines).where(and(eq(bankStatementLines.bankAccountId, bankId), eq(bankStatementLines.description, description))))[0];
const balance = () => cashBalanceAsOf(org.tenantId, [bankLedgerId], today);
const issue = (n: string, amount: number, chequeDaysAgo: number) =>
  issueCheque(org.tenantId, org.userId, { bankAccountId: bankLedgerId, chequeNumber: n, payeeKind: "supplier", vendorId, expenseId: null, amount, issueDate: ago(chequeDaysAgo + 1), chequeDate: ago(chequeDaysAgo), memo: null, replacesId: null }, today);

beforeAll(async () => {
  org = await createTempOrg("ZZ Cheque Reconcile");
  const [group] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1010")));
  bankLedgerId = (await createSubAccount(org.tenantId, group, "Cheque Test Bank")).id;
  const [equity] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "3000")));
  await postJournalEntry({ tenantId: org.tenantId, entryDate: ago(60), sourceType: "opening_balance", createdBy: org.userId, lines: [{ accountId: bankLedgerId, debitAmount: 100000 }, { accountId: equity.id, creditAmount: 100000 }] });
  await A.createBankAccount({ bankName: "Test Bank", accountName: "Main", accountNumber: "", branch: "", currency: "NPR", openingBalance: 0, chartOfAccountsLink: bankLedgerId });
  bankId = (await db.select().from(bankAccounts).where(eq(bankAccounts.tenantId, org.tenantId)))[0].id;
  vendorId = (await db.insert(vendors).values({ tenantId: org.tenantId, name: "Match Supplier" }).returning())[0].id;
  customerId = (await db.insert(customers).values({ tenantId: org.tenantId, name: "Match Customer" }).returning())[0].id;
});
afterAll(async () => {
  await db.delete(issuedCheques).where(eq(issuedCheques.tenantId, org.tenantId));
  await db.delete(receivedCheques).where(eq(receivedCheques.tenantId, org.tenantId));
  await org.remove();
});

describe("matching a bank line to a cheque", () => {
  it("offers the cheque for a bank line with the same amount and its number", async () => {
    await issue("004512", 8000, 5);
    await importRows([`${ago(3)},CLG CHQ 4512,-8000`, `${ago(3)},Monthly charge,-100`]);
    const found = await C.getChequeMatchesForAccount(bankId);
    const line = await lineOf("CLG CHQ 4512");
    expect(found[line.id]).toHaveLength(1);
    expect(found[line.id][0]).toMatchObject({ kind: "issued", chequeNumber: "004512", tier: "exact", party: "Match Supplier" });
    expect(found[(await lineOf("Monthly charge")).id]).toBeUndefined();
  });

  it("clears the cheque and matches the line in one step", async () => {
    const line = await lineOf("CLG CHQ 4512");
    const [cheque] = await db.select().from(issuedCheques).where(eq(issuedCheques.chequeNumber, "004512"));
    const before = await balance();
    const r = await C.confirmChequeMatch({ bankAccountId: bankId, statementLineId: line.id, kind: "issued", chequeId: cheque.id, score: 100 });
    expect(r).toEqual({ ok: true });
    expect(await balance()).toBe(before - 8000);
    expect((await db.select().from(issuedCheques).where(eq(issuedCheques.id, cheque.id)))[0]).toMatchObject({ status: "cleared", clearedDate: ago(3) });
    expect((await db.select().from(bankStatementLines).where(eq(bankStatementLines.id, line.id)))[0].matchStatus).toBe("matched");
    const [pay] = await db.select().from(payments).where(eq(payments.id, (await db.select().from(issuedCheques).where(eq(issuedCheques.id, cheque.id)))[0].paymentId!));
    expect(pay).toMatchObject({ paymentType: "supplier_payment", paymentDate: ago(3), status: "posted" });
  });

  it("will not match the same cheque twice, or a line that is already matched", async () => {
    const line = await lineOf("CLG CHQ 4512");
    const [cheque] = await db.select().from(issuedCheques).where(eq(issuedCheques.chequeNumber, "004512"));
    const again = await C.confirmChequeMatch({ bankAccountId: bankId, statementLineId: line.id, kind: "issued", chequeId: cheque.id });
    expect(again.ok).toBe(false);
  });

  it("clears a customer cheque from a deposit line", async () => {
    const { id } = await receiveCheque(org.tenantId, org.userId, { customerId, drawerBank: "Nabil Bank", chequeNumber: "778801", amount: 5000, receivedDate: ago(8), chequeDate: ago(6), memo: null }, today);
    await depositReceived(org.tenantId, id, bankLedgerId, ago(5), today);
    await importRows([`${ago(2)},CHQ DEP 778801,5000`]);
    const found = await C.getChequeMatchesForAccount(bankId);
    const line = await lineOf("CHQ DEP 778801");
    expect(found[line.id][0]).toMatchObject({ kind: "received", chequeNumber: "778801", tier: "exact" });
    const before = await balance();
    expect(await C.confirmChequeMatch({ bankAccountId: bankId, statementLineId: line.id, kind: "received", chequeId: id })).toEqual({ ok: true });
    expect(await balance()).toBe(before + 5000);
    expect((await db.select().from(receivedCheques).where(eq(receivedCheques.id, id)))[0]).toMatchObject({ status: "cleared", clearedDate: ago(2) });
    expect((await db.select().from(bankStatementLines).where(eq(bankStatementLines.id, line.id)))[0].matchStatus).toBe("matched");
  });

  it("refuses a bank line whose amount is not the cheque's", async () => {
    await issue("004513", 3000, 4);
    await importRows([`${ago(1)},Some withdrawal,-3100`]);
    const line = await lineOf("Some withdrawal");
    const [cheque] = await db.select().from(issuedCheques).where(eq(issuedCheques.chequeNumber, "004513"));
    const r = await C.confirmChequeMatch({ bankAccountId: bankId, statementLineId: line.id, kind: "issued", chequeId: cheque.id });
    expect(r.ok).toBe(false);
    expect((await db.select().from(issuedCheques).where(eq(issuedCheques.id, cheque.id)))[0].status).toBe("issued");
  });

  it("takes the clearing back when the match cannot be made", async () => {
    const [cheque] = await db.select().from(issuedCheques).where(eq(issuedCheques.chequeNumber, "004513"));
    await importRows([`${ago(1)},CHQ 4513 clearing,-3000`]);
    const line = await lineOf("CHQ 4513 clearing");
    const before = await balance();
    await expect(
      matchChequeToLine(org.tenantId, org.userId, { bankChartId: bankLedgerId, line: { id: line.id, date: line.transactionDate, amount: Number(line.amount) }, kind: "issued", chequeId: cheque.id }, today, async () => {
        throw new Error("The match was refused");
      })
    ).rejects.toThrow("The match was refused");
    expect(await balance()).toBe(before);
    expect((await db.select().from(issuedCheques).where(eq(issuedCheques.id, cheque.id)))[0]).toMatchObject({ status: "issued", paymentId: null, clearedDate: null });
    const pays = await db.select().from(payments).where(and(eq(payments.tenantId, org.tenantId), eq(payments.chequeNumber, "004513")));
    expect(pays.every((p) => p.status === "voided")).toBe(true);
  });
});
