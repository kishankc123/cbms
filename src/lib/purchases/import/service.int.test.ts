import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines, purchaseBills, purchaseImports, supplierAliases, tenantTaxRegistrations, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { createSubAccount } from "@/lib/ledger/control-accounts";
import { analyzePurchaseFile, checkPurchaseImport, finishPurchaseImport, importBillIds, importPurchaseChunk, listPurchaseImports, preparePurchaseImport, reviewPurchaseFile } from "./service";
import type { PurchaseDateOptions, PurchaseImportSettings, PurchaseRunInput } from "./types";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let stationeryId: string;
let cleaningId: string;
let acmeId: string;

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const DATES: PurchaseDateOptions = { choice: "AD", dayFirst: true, allowMixed: false };
const SETTINGS: PurchaseImportSettings = { amountsIncludeVat: false, defaultBillType: "vat", paidMode: "file", defaultAccountId: null, defaultCategoryId: null };
const CSV = [
  "Bill Date,Vendor,Category,Bill No,Particulars,Amount,Bill Type,Paid,Paid From",
  "2026-09-10,Acme Traders,Stationery,B-1,Paper,10000,VAT,0,",
  "2026-09-11,Acme Trader,Cleaning,B-2,Mops,2000,PAN,0,",
  "2026-09-12,Brand New Supplies,Stationery,,Pens,500,VAT,0,",
  "2026-09-13,,Stationery,,Tea,850,No bill,850,Cash",
  "2026-09-14,Acme Traders,Stationary,B-5,Typo category,100,VAT,0,",
  "2026-09-15,Acme Traders,Stationery,B-6,Bad amount,abc,VAT,0,",
].join("\n");
const MAPPING = { date: "Bill Date", supplier: "Vendor", category: "Category", billNumber: "Bill No", description: "Particulars", amount: "Amount", billType: "Bill Type", paid: "Paid", account: "Paid From" };

const base = (text = CSV, settings = SETTINGS) => ({ fileName: "purchases.csv", base64: b64(text), mapping: MAPPING, dateOptions: DATES, settings });
const runInput = (over: Partial<PurchaseRunInput> = {}): PurchaseRunInput => ({ ...base(), supplierDecisions: {}, categoryDecisions: {}, skipRows: [], includeDuplicates: false, ...over });
const balance = async (code: string) => {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code)));
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0) * 100) / 100;
};

/** What the screen does: prepare, then post the rows in slices of a few, then close the import. */
async function runWholeImport(input: PurchaseRunInput, slice = 5) {
  const prep = await preparePurchaseImport({ tenantId: org.tenantId, userId: org.userId }, input);
  if (!prep.ok) return prep;
  let imported = 0;
  let stopped = false;
  for (let i = 0; i < prep.rowNumbers.length && !stopped; i += slice) {
    const r = await importPurchaseChunk({ tenantId: org.tenantId, userId: org.userId }, { ...input, supplierDecisions: prep.supplierDecisions, importId: prep.importId, rowNumbers: prep.rowNumbers.slice(i, i + slice) });
    if (!r.ok) throw new Error(r.error);
    imported += r.imported;
    stopped = Boolean(r.stopped);
  }
  const done = await finishPurchaseImport({ tenantId: org.tenantId, userId: org.userId }, { importId: prep.importId, stopped });
  return { ...prep, imported, done };
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Purchase Import");
  await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
  const [cogs] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "5000")));
  stationeryId = (await createSubAccount(org.tenantId, cogs, "Stationery")).id;
  cleaningId = (await createSubAccount(org.tenantId, cogs, "Cleaning")).id;
  [{ id: acmeId }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Acme Traders", openingBalance: "0" }).returning({ id: vendors.id });
});
afterAll(async () => {
  await org.remove();
});

describe("reading the file", () => {
  it("finds the columns by itself", async () => {
    const a = await analyzePurchaseFile(org.tenantId, { fileName: "p.csv", base64: b64(CSV) });
    expect(a).toMatchObject({ rowCount: 6, mappingComplete: true, remembered: false });
    expect(a.mapping).toMatchObject({ date: "Bill Date", supplier: "Vendor", category: "Category", billNumber: "Bill No", description: "Particulars", amount: "Amount" });
  });
});

describe("the review", () => {
  it("matches suppliers and categories, groups the unknown ones with suggestions, and explains each problem", async () => {
    const r = await reviewPurchaseFile(org.tenantId, base());
    const row = (n: number) => r.rows.find((x) => x.rowNumber === n)!;
    expect(row(2)).toMatchObject({ status: "ready", supplierName: "Acme Traders", categoryName: "Stationery", total: 11300, tax: 1300 });
    expect(row(3)).toMatchObject({ status: "attention", issues: ["supplier"], total: 2000 }); // PAN bill: no VAT; "Acme Trader" isn't a supplier yet
    expect(row(4)).toMatchObject({ status: "attention", issues: ["supplier"], total: 565 });
    expect(row(5)).toMatchObject({ status: "ready", supplierName: null, paid: 850 }); // paid in full, no supplier needed
    expect(row(6)).toMatchObject({ status: "attention", issues: ["category"] });
    expect(row(7)).toMatchObject({ status: "attention", issues: ["amount"] });

    expect(r.supplierGroups.map((g) => g.text).sort()).toEqual(["Acme Trader", "Brand New Supplies"]);
    expect(r.supplierGroups.find((g) => g.text === "Acme Trader")!.suggestion).toMatchObject({ vendorId: acmeId });
    expect(r.categoryGroups).toHaveLength(1);
    expect(r.categoryGroups[0]).toMatchObject({ text: "Stationary", suggestion: { categoryId: stationeryId } });
  });

  it("a default category stands in when the file has none, and an amount that includes VAT is worked back", async () => {
    const text = "Date,Vendor,Amount,Bill Type\n2026-09-10,Acme Traders,1130,VAT";
    const r = await reviewPurchaseFile(org.tenantId, { ...base(text, { ...SETTINGS, amountsIncludeVat: true, defaultCategoryId: cleaningId }), mapping: { date: "Date", supplier: "Vendor", amount: "Amount", billType: "Bill Type" } });
    expect(r.rows[0]).toMatchObject({ status: "ready", total: 1130, tax: 130, categoryName: "Cleaning" });
  });
});

describe("importing in steps", () => {
  const decisions = () => ({
    supplierDecisions: { "acme trader": { action: "existing" as const, vendorId: acmeId, remember: true }, "brand new supplies": { action: "create" as const, name: "Brand New Supplies" } },
    categoryDecisions: { stationary: { action: "existing" as const, categoryId: stationeryId } },
  });

  it("check only changes nothing", async () => {
    const before = { vendors: (await db.select().from(vendors).where(eq(vendors.tenantId, org.tenantId))).length, bills: (await db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId))).length, imports: (await db.select().from(purchaseImports).where(eq(purchaseImports.tenantId, org.tenantId))).length };
    const r = await checkPurchaseImport(org.tenantId, runInput(decisions()));
    expect(r).toMatchObject({ wouldImport: 5, total: 11300 + 2000 + 565 + 850 + 113, suppliersToCreate: ["Brand New Supplies"] });
    expect(r.skipped).toHaveLength(1);
    const after = { vendors: (await db.select().from(vendors).where(eq(vendors.tenantId, org.tenantId))).length, bills: (await db.select().from(purchaseBills).where(eq(purchaseBills.tenantId, org.tenantId))).length, imports: (await db.select().from(purchaseImports).where(eq(purchaseImports.tenantId, org.tenantId))).length };
    expect(after).toEqual(before);
  });

  it("posts the clean rows like Add New, in slices, creating only ticked suppliers", { timeout: 300000 }, async () => {
    const r = await runWholeImport(runInput(decisions()));
    expect(r).toMatchObject({ ok: true, imported: 5, suppliersCreated: ["Brand New Supplies"] });
    if (!("importId" in r) || !r.ok) return;
    expect(r.done).toMatchObject({ imported: 5, total: 11300 + 2000 + 565 + 850 + 113 });
    expect(r.skipped.map((s) => s.rowNumber)).toEqual([7]);

    const bills = await db.select().from(purchaseBills).where(eq(purchaseBills.importId, r.importId));
    expect(bills).toHaveLength(5);
    const byTotal = (t: number) => bills.find((b) => Number(b.total) === t)!;
    expect(byTotal(11300)).toMatchObject({ billType: "vat", billNumber: "B-1", status: "open", purchaseType: "cash" });
    expect(byTotal(2000)).toMatchObject({ billType: "pan", taxAmount: "0.00", billNumber: "B-2" });
    expect(byTotal(850)).toMatchObject({ billType: "no_bill", status: "paid", vendorId: null });
    expect(bills.filter((b) => b.billNumber.startsWith("AUTO-"))).toHaveLength(2); // the two rows with no bill number

    // the books: Stationery 10,000 + 500 + 850 + 100, Cleaning 2,000; input VAT claimed (registered); 850 paid in cash
    expect(await balance("1000")).toBe(-850);
    expect(await balance("1300")).toBe(1300 + 65 + 13);

    const [imp] = await db.select().from(purchaseImports).where(eq(purchaseImports.id, r.importId));
    expect(imp).toMatchObject({ billCount: 5, status: "completed", rowCount: 6 });
    expect((await listPurchaseImports(org.tenantId))[0]).toMatchObject({ id: r.importId, active: 5 });
    expect(await importBillIds(org.tenantId, r.importId)).toHaveLength(5);
  });

  it("remembers the supplier match and the layout, and finds the same file already in the books", async () => {
    expect((await db.select().from(supplierAliases).where(eq(supplierAliases.tenantId, org.tenantId))).map((a) => a.alias)).toEqual(["acme trader"]);
    expect((await analyzePurchaseFile(org.tenantId, { fileName: "again.csv", base64: b64(CSV) })).remembered).toBe(true);

    const r = await reviewPurchaseFile(org.tenantId, base());
    expect(r.supplierGroups).toHaveLength(0);
    expect(r.counts.duplicate).toBe(4); // the numbered bills by number, the unnumbered ones by date, supplier and amount
    const again = await preparePurchaseImport({ tenantId: org.tenantId, userId: org.userId }, runInput(decisions()));
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to import/) });
  });

  it("refuses another organization's supplier and a made-up account or category", async () => {
    const text = "Date,Vendor,Amount\n2026-10-01,Mystery,500";
    const input = { ...runInput(), base64: b64(text), mapping: { date: "Date", supplier: "Vendor", amount: "Amount" } };
    expect(await preparePurchaseImport({ tenantId: org.tenantId, userId: org.userId }, { ...input, settings: { ...SETTINGS, defaultAccountId: "00000000-0000-0000-0000-000000000000" } })).toMatchObject({ ok: false, error: expect.stringMatching(/cash or bank account/) });
    expect(await preparePurchaseImport({ tenantId: org.tenantId, userId: org.userId }, { ...input, settings: { ...SETTINGS, defaultCategoryId: "00000000-0000-0000-0000-000000000000" } })).toMatchObject({ ok: false, error: expect.stringMatching(/purchase category/) });
  });
});
