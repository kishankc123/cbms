import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, payments, salesInvoices } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { assertCashBankAccounts } from "@/lib/ledger/account-guards";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { reverseJournalEntry } from "@/lib/ledger/post";
import { listPaymentModes, resolvePaymentMode, updatePaymentMode, buildPaymentResolver } from "@/lib/payment-modes";
import { runSalesImport } from "@/lib/sales/import/service";
import { postSalesBatch } from "@/lib/sales/invoice-records";
import { paymentModesByInvoice } from "@/lib/sales/invoice-payment-modes";
import type { ImportSettings } from "@/lib/sales/import/types";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let walletId: string;
let cashId: string;
let fonepayMode: string;
let cashMode: string;
let cardMode: string;

beforeAll(async () => {
  org = await createTempOrg("ZZ Payment Mode Posting");
  [{ id: walletId }] = await db.insert(accounts).values({ tenantId: org.tenantId, code: "1020", name: "Fonepay Wallet", category: "asset", subCategory: "Current assets" }).returning({ id: accounts.id });
  cashId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
  const modes = await listPaymentModes(org.tenantId);
  fonepayMode = modes.find((m) => m.name === "Fonepay")!.id;
  cashMode = modes.find((m) => m.name === "Cash")!.id;
  cardMode = modes.find((m) => m.name === "Card")!.id;
  await updatePaymentMode(org.tenantId, org.userId, fonepayMode, { name: "Fonepay", isActive: true, accountIds: [walletId] });
});
afterAll(async () => {
  await org.remove();
});

describe("saving the payment mode", () => {
  it("a linked wallet account outside Cash and Bank counts as a cash/bank account everywhere", async () => {
    const groups = await getCashBankAccounts(org.tenantId);
    expect(groups.some((g) => g.id === walletId)).toBe(true);
    await expect(assertCashBankAccounts(org.tenantId, [walletId])).resolves.toBeUndefined();
  });

  it("refuses a mode that is not the organization's, inactive, or not linked to the account", async () => {
    await expect(resolvePaymentMode(org.tenantId, cashMode, walletId)).rejects.toThrow(/not available under the chosen payment mode/);
    await expect(resolvePaymentMode(org.tenantId, cardMode, cashId)).rejects.toThrow(/not available/);
    await expect(resolvePaymentMode(org.tenantId, "00000000-0000-0000-0000-000000000000", cashId)).rejects.toThrow(/not available/);
    expect(await resolvePaymentMode(org.tenantId, fonepayMode, walletId)).toMatchObject({ paymentModeName: "Fonepay", paymentMethod: "online" });
    expect(await resolvePaymentMode(org.tenantId, null, cashId)).toMatchObject({ paymentModeId: null, paymentMethod: "cash" });
  });

  it("a payment on an invoice keeps its mode on the journal line and the payment record, and a reversal keeps it too", async () => {
    const [made] = await postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [{ invoiceDate: "2026-09-10", customerId: "", grossAmount: 1000, discountAmount: 0, billType: "zero_rated", payments: [{ accountId: walletId, amount: 1000, modeId: fonepayMode }] }]);

    const lines = await db
      .select({ account: journalLines.accountId, mode: journalLines.paymentModeId, name: journalLines.paymentModeName, debit: journalLines.debitAmount, entry: journalEntries.id, type: journalEntries.sourceType })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
      .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, made.invoiceId), eq(journalLines.accountId, walletId)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ mode: fonepayMode, name: "Fonepay", type: "receipt" });

    const [pay] = await db.select().from(payments).where(and(eq(payments.tenantId, org.tenantId), eq(payments.accountId, walletId)));
    expect(pay).toMatchObject({ paymentModeId: fonepayMode, paymentModeName: "Fonepay", paymentMethod: "online" });

    const reversal = await reverseJournalEntry(org.tenantId, lines[0].entry, org.userId);
    const back = await db.select().from(journalLines).where(and(eq(journalLines.journalEntryId, reversal.id), eq(journalLines.accountId, walletId)));
    expect(back[0]).toMatchObject({ paymentModeId: fonepayMode, paymentModeName: "Fonepay" });
  });

  it("the invoice list shows how each invoice was paid: every mode of a split payment, the account for an older payment, nothing for an unpaid one", async () => {
    const made = await postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [
      { invoiceDate: "2026-09-12", customerId: "", grossAmount: 600, discountAmount: 0, billType: "zero_rated", payments: [{ accountId: walletId, amount: 400, modeId: fonepayMode }, { accountId: cashId, amount: 200, modeId: cashMode }] },
      { invoiceDate: "2026-09-12", customerId: "", grossAmount: 100, discountAmount: 0, billType: "zero_rated", payments: [{ accountId: cashId, amount: 100 }] }, // no mode, as before modes existed
    ]);
    const shown = await paymentModesByInvoice(org.tenantId, [made[0].invoiceId, made[1].invoiceId]);
    expect(shown[made[0].invoiceId]).toEqual(["Fonepay", "Cash"]);
    expect(shown[made[1].invoiceId]).toEqual(["Cash"]); // the account's name
    expect(await paymentModesByInvoice(org.tenantId, ["00000000-0000-0000-0000-000000000000"])).toEqual({});

    // taking a payment back (as an edit or a void does) leaves no trace in the list: not the reversal's receivable line either
    const [receipt] = await db.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceId, made[1].invoiceId), eq(journalEntries.sourceType, "receipt")));
    await reverseJournalEntry(org.tenantId, receipt.id, org.userId);
    expect(await paymentModesByInvoice(org.tenantId, [made[1].invoiceId])).toEqual({});
  });

  it("a wrong mode and account pair is refused before anything is posted", async () => {
    const before = (await db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, org.tenantId))).length;
    await expect(postSalesBatch({ tenantId: org.tenantId, userId: org.userId }, [{ invoiceDate: "2026-09-11", customerId: "", grossAmount: 500, discountAmount: 0, billType: "zero_rated", payments: [{ accountId: cashId, amount: 500, modeId: fonepayMode }] }])).rejects.toThrow(/not available under the chosen payment mode/);
    expect((await db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, org.tenantId))).length).toBe(before);
  });

  it("an import cell can name an account or a mode with one account; the mode is recorded", { timeout: 200000 }, async () => {
    const resolver = await buildPaymentResolver(org.tenantId);
    expect(resolver.resolve("Fonepay")).toEqual({ accountId: walletId, modeId: fonepayMode });
    expect(resolver.resolve("1020")).toEqual({ accountId: walletId, modeId: fonepayMode });
    expect(resolver.resolve("Card")).toBeNull(); // nothing linked yet, so it is not offered
    expect(resolver.resolve("nonsense")).toBeNull();

    const csv = ["Date,Amount,Bill Type,Paid,Received into", "2026-09-12,300,Zero rated,300,Fonepay", "2026-09-13,200,Zero rated,200,Cash"].join("\n");
    const settings: ImportSettings = { amountsIncludeVat: false, defaultBillType: "zero_rated", paidMode: "file", defaultAccountId: null };
    const r = await runSalesImport(
      { tenantId: org.tenantId, userId: org.userId },
      { fileName: "m.csv", base64: Buffer.from(csv, "utf8").toString("base64"), mapping: { date: "Date", amount: "Amount", billType: "Bill Type", paid: "Paid", account: "Received into" }, dateOptions: { choice: "AD", dayFirst: true, allowMixed: false }, settings, decisions: {}, skipRows: [], includeDuplicates: true }
    );
    expect(r).toMatchObject({ ok: true, imported: 2 });
    const rows = await db.select({ name: journalLines.paymentModeName, account: journalLines.accountId }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId)).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, "receipt")));
    expect(rows.filter((x) => x.account === walletId && x.name === "Fonepay").length).toBeGreaterThanOrEqual(2); // the first test invoice and the imported one
    expect(rows.some((x) => x.account === cashId && x.name === "Cash")).toBe(true);
  });
});
