import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customerAliases, customers, journalEntries, journalLines, salesImports, salesInvoices, tenantTaxRegistrations } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { analyzeSalesFile, checkSalesImport, importInvoiceIds, listSalesImports, reviewSalesFile, runSalesImport } from "./service";
import type { DateOptions, ImportSettings } from "./types";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let cashId: string;
let himalId: string;

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const SETTINGS: ImportSettings = { amountsIncludeVat: false, defaultBillType: "taxable", paidMode: "file", defaultAccountId: null };
const DATES: DateOptions = { choice: "AD", dayFirst: true, allowMixed: false };
const CSV = [
  "Invoice Date,Party Name,Amount,Discount,Bill Type,Paid,Received Into",
  "2026-09-10,Himal Enterprises,10000,0,Taxable,0,",
  "2026-09-11,Hamal Entrprises,5000,500,Zero rated,0,",
  "2026-09-12,Brand New Traders,2000,0,,0,",
  "2026-09-13,,1000,0,Taxable,1130,Cash",
  "2026-09-14,Himal Enterprises,abc,0,,0,",
  "not a date,Himal Enterprises,100,0,,0,",
].join("\n");
const MAPPING = { date: "Invoice Date", customer: "Party Name", amount: "Amount", discount: "Discount", billType: "Bill Type", paid: "Paid", account: "Received Into" };

const base = (text = CSV, settings = SETTINGS) => ({ fileName: "sales.csv", base64: b64(text), mapping: MAPPING, dateOptions: DATES, settings });
const balance = async (code: string) => {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code)));
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0) * 100) / 100;
};

beforeAll(async () => {
  org = await createTempOrg("ZZ Sales Import");
  await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
  [{ id: himalId }] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Himal Enterprises", openingBalance: "0" }).returning({ id: customers.id });
  cashId = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "1000"))))[0].id;
});
afterAll(async () => {
  await org.remove();
});

describe("reading the file", () => {
  it("finds the columns by itself and says when it recognises none of them", async () => {
    const a = await analyzeSalesFile(org.tenantId, { fileName: "sales.csv", base64: b64(CSV) });
    expect(a).toMatchObject({ rowCount: 6, mappingComplete: true, remembered: false });
    expect(a.mapping).toMatchObject({ date: "Invoice Date", customer: "Party Name", amount: "Amount", billType: "Bill Type", paid: "Paid", account: "Received Into" });
    const odd = await analyzeSalesFile(org.tenantId, { fileName: "x.csv", base64: b64("A,B\n1,2") });
    expect(odd.mappingComplete).toBe(false);
  });
});

describe("the review", () => {
  it("matches known customers, groups unknown names with a suggestion, and explains each problem row", async () => {
    const r = await reviewSalesFile(org.tenantId, base());
    expect(r.counts).toEqual({ ready: 2, attention: 4, duplicate: 0, skipped: 0 });
    const row = (n: number) => r.rows.find((x) => x.rowNumber === n)!;
    expect(row(2)).toMatchObject({ status: "ready", customerName: "Himal Enterprises", total: 11300, tax: 1300 }); // 13% VAT on 10,000
    expect(row(3)).toMatchObject({ status: "attention", issues: ["customer"], total: 4500 }); // zero-rated: no VAT, after the discount
    expect(row(4)).toMatchObject({ status: "attention", issues: ["customer"], total: 2260 });
    expect(row(5)).toMatchObject({ status: "ready", customerName: null, paid: 1130 }); // a cash sale, paid in full into Cash
    expect(row(6)).toMatchObject({ status: "attention", issues: ["amount"] });
    expect(row(7)).toMatchObject({ status: "attention", issues: ["date"] });
    expect(r.groups.map((g) => g.text).sort()).toEqual(["Brand New Traders", "Hamal Entrprises"]);
    expect(r.groups.find((g) => g.text === "Hamal Entrprises")!.suggestion).toMatchObject({ customerId: himalId, name: "Himal Enterprises" });
    expect(r.groups.find((g) => g.text === "Brand New Traders")!.suggestion).toBeNull();
    expect(r.importTotal).toBe(11300 + 4500 + 2260 + 1130); // rows waiting only on a customer count toward what is to come
  });

  it("an amount that includes VAT is worked back, and a default account stands in when the file names none", async () => {
    const text = "Date,Customer,Amount,Paid\n2026-09-10,Himal Enterprises,1130,1130";
    const r = await reviewSalesFile(org.tenantId, { ...base(text, { ...SETTINGS, amountsIncludeVat: true, defaultAccountId: cashId }), mapping: { date: "Date", customer: "Customer", amount: "Amount", paid: "Paid" } });
    expect(r.rows[0]).toMatchObject({ status: "ready", total: 1130, tax: 130, paid: 1130 });
  });
});

describe("importing", () => {
  const decisions = {
    "hamal entrprises": { action: "existing" as const, customerId: "", remember: true },
    "brand new traders": { action: "create" as const, name: "Brand New Traders" },
  };

  it("posts the clean rows like Multi-Invoice, creates only ticked customers, and numbers the invoices in order", async () => {
    decisions["hamal entrprises"].customerId = himalId;
    const r = await runSalesImport({ tenantId: org.tenantId, userId: org.userId }, { ...base(), decisions, skipRows: [], includeDuplicates: false });
    expect(r).toMatchObject({ ok: true, imported: 4, total: 11300 + 4500 + 2260 + 1130, customersCreated: ["Brand New Traders"] });
    if (!r.ok) return;
    expect(r.skipped.map((s) => s.rowNumber).sort()).toEqual([6, 7]);

    const invoices = await db.select().from(salesInvoices).where(eq(salesInvoices.importId, r.importId));
    expect(invoices).toHaveLength(4);
    const byTotal = (t: number) => invoices.find((i) => Number(i.total) === t)!;
    expect(byTotal(11300)).toMatchObject({ taxTreatment: "taxable", status: "sent", amountPaid: "0.00" });
    expect(byTotal(4500)).toMatchObject({ taxTreatment: "zero_rated", taxAmount: "0.00" });
    expect(byTotal(1130)).toMatchObject({ status: "paid", amountPaid: "1130.00" });

    // the books: sales revenue 10,000 + 4,500 + 2,000 + 1,000, VAT 1,300 + 260 + 130, and the 1,130 cash received
    expect(await balance("4000")).toBe(-(10000 + 4500 + 2000 + 1000));
    expect(await balance("2100")).toBe(-(1300 + 260 + 130));
    expect(await balance("1000")).toBe(1130);

    const [imp] = await db.select().from(salesImports).where(eq(salesImports.id, r.importId));
    expect(imp).toMatchObject({ invoiceCount: 4, status: "completed", rowCount: 6 });
    expect(imp.customersCreated.map((c) => c.name)).toEqual(["Brand New Traders"]);
    expect((await listSalesImports(org.tenantId))[0]).toMatchObject({ id: r.importId, active: 4 });
    expect(await importInvoiceIds(org.tenantId, r.importId)).toHaveLength(4);
  });

  it("remembers the match and the column mapping for next time", async () => {
    const aliases = await db.select().from(customerAliases).where(eq(customerAliases.tenantId, org.tenantId));
    expect(aliases.map((a) => [a.alias, a.customerId])).toEqual([["hamal entrprises", himalId]]);

    const a = await analyzeSalesFile(org.tenantId, { fileName: "again.csv", base64: b64(CSV) });
    expect(a.remembered).toBe(true);
    const r = await reviewSalesFile(org.tenantId, base());
    expect(r.groups).toHaveLength(0); // both names now match on their own
  });

  it("importing the same file again finds every row already in the books", async () => {
    const r = await reviewSalesFile(org.tenantId, base());
    expect(r.counts.duplicate).toBe(4);
    const refused = await runSalesImport({ tenantId: org.tenantId, userId: org.userId }, { ...base(), decisions: {}, skipRows: [], includeDuplicates: false });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to import/) });
  });

  it("never trusts the browser: a customer from another organization, or a made-up account, is refused", async () => {
    const other = await createTempOrg("ZZ Sales Import Other");
    const [foreign] = await db.insert(customers).values({ tenantId: other.tenantId, name: "Foreign Co", openingBalance: "0" }).returning({ id: customers.id });
    try {
      const text = "Date,Customer,Amount\n2026-10-01,Mystery Buyer,500";
      const mapping = { date: "Date", customer: "Customer", amount: "Amount" };
      const r = await runSalesImport({ tenantId: org.tenantId, userId: org.userId }, { fileName: "m.csv", base64: b64(text), mapping, dateOptions: DATES, settings: SETTINGS, decisions: { "mystery buyer": { action: "existing", customerId: foreign.id, remember: true } }, skipRows: [], includeDuplicates: false });
      expect(r).toMatchObject({ ok: false }); // the foreign id is ignored, so the customer is still undecided and nothing imports
      const bad = await runSalesImport({ tenantId: org.tenantId, userId: org.userId }, { fileName: "m.csv", base64: b64(text), mapping, dateOptions: DATES, settings: { ...SETTINGS, defaultAccountId: "00000000-0000-0000-0000-000000000000" }, decisions: {}, skipRows: [], includeDuplicates: false });
      expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/cash or bank account/) });
    } finally {
      await db.delete(customers).where(eq(customers.id, foreign.id));
      await other.remove();
    }
  });
});

describe("correcting rows in the review, and checking without importing", () => {
  const FIX = ["Date,Customer,Amount", "2026-10-01,Himal Enterprises,abc", "not a date,Himal Enterprises,100", "2026-10-03,Himal Enterprises,200"].join("\n");
  const MAP = { date: "Date", customer: "Customer", amount: "Amount" };
  const fixBase = { fileName: "fix.csv", base64: b64(FIX), mapping: MAP, dateOptions: DATES, settings: SETTINGS };

  it("typed corrections replace the file's cells, and re-check the row", async () => {
    const before = await reviewSalesFile(org.tenantId, fixBase);
    expect(before.rows.map((r) => r.status)).toEqual(["attention", "attention", "ready"]);

    const after = await reviewSalesFile(org.tenantId, { ...fixBase, overrides: { 2: { amount: "750" }, 3: { date: "2026-10-02" } } });
    expect(after.rows.map((r) => r.status)).toEqual(["ready", "ready", "ready"]);
    expect(after.rows[0]).toMatchObject({ total: 847.5, raw: { amount: "750" } });
    expect(after.rows[1].dateIso).toBe("2026-10-02");
  });

  it("a customer can be typed in for a row even when the file has no customer column", async () => {
    const noCustomer = { ...fixBase, base64: b64("Date,Amount\n2026-10-04,300"), mapping: { date: "Date", amount: "Amount" } };
    expect((await reviewSalesFile(org.tenantId, noCustomer)).rows[0]).toMatchObject({ status: "attention", issues: ["customer"] });
    const typed = await reviewSalesFile(org.tenantId, { ...noCustomer, overrides: { 2: { customer: "Himal Enterprises" } } });
    expect(typed.rows[0]).toMatchObject({ status: "ready", customerName: "Himal Enterprises" });
  });

  it("check only says what would happen and changes nothing", async () => {
    const counts = async () => ({
      customers: (await db.select().from(customers).where(eq(customers.tenantId, org.tenantId))).length,
      invoices: (await db.select().from(salesInvoices).where(eq(salesInvoices.tenantId, org.tenantId))).length,
      imports: (await db.select().from(salesImports).where(eq(salesImports.tenantId, org.tenantId))).length,
    });
    const text = ["Date,Customer,Amount", "2026-10-05,Check Only Traders,1000", "2026-10-06,Himal Enterprises,500", "bad,Himal Enterprises,50"].join("\n");
    const input = { fileName: "check.csv", base64: b64(text), mapping: MAP, dateOptions: DATES, settings: SETTINGS, decisions: { "check only traders": { action: "create" as const, name: "Check Only Traders" } }, skipRows: [], includeDuplicates: false };
    const before = await counts();
    const r = await checkSalesImport(org.tenantId, input);
    expect(r).toMatchObject({ wouldImport: 2, total: 1130 + 565, tax: 130 + 65, customersToCreate: ["Check Only Traders"] });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ rowNumber: 4, reason: expect.stringMatching(/date/i) });
    expect(await counts()).toEqual(before);

    // and the real import then does exactly what the check said
    const real = await runSalesImport({ tenantId: org.tenantId, userId: org.userId }, input);
    expect(real).toMatchObject({ ok: true, imported: 2, total: 1695, customersCreated: ["Check Only Traders"] });
  });

  it("corrections made in the review carry into the import", async () => {
    const r = await runSalesImport({ tenantId: org.tenantId, userId: org.userId }, { ...fixBase, decisions: {}, skipRows: [], includeDuplicates: false, overrides: { 2: { amount: "750" }, 3: { date: "2026-10-02" } } });
    expect(r).toMatchObject({ ok: true, imported: 3 });
  });
});
