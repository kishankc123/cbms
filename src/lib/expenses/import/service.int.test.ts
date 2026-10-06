import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, expenseImports, expenses, supplierAliases, vendors } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { analyzeExpenseFile, checkExpenseImport, finishExpenseImport, importExpenseChunk, importExpenseIds, prepareExpenseImport, reviewExpenseFile } from "./service";
import type { ExpenseDateOptions, ExpenseImportSettings, ExpenseRunInput } from "./types";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let rentName: string;
let acmeId: string;

const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");
const DATES: ExpenseDateOptions = { choice: "AD", dayFirst: true, allowMixed: false };
const SETTINGS: ExpenseImportSettings = { amountsIncludeVat: false, defaultBillType: "pan", paidMode: "file", defaultAccountId: null, defaultCategoryId: null };
const MAPPING = { date: "Date", supplier: "Paid To", category: "Head", invoiceNumber: "Inv", description: "Details", amount: "Amount", paid: "Paid", account: "Mode" };
const csv = (cat: string) =>
  [
    "Date,Paid To,Head,Inv,Details,Amount,Paid,Mode",
    `2026-09-10,Acme Traders,${cat},R-1,Rent,1000,0,`,
    `2026-09-11,Acme Trader,${cat},R-2,Rent 2,500,0,`,
    `2026-09-12,,${cat},,Taxi,200,200,Cash`,
    `2026-09-13,Acme Traders,Nonsense,R-4,Bad head,100,0,`,
  ].join("\n");
const runInput = (over: Partial<ExpenseRunInput> = {}): ExpenseRunInput => ({
  fileName: "expenses.csv",
  base64: b64(csv(rentName)),
  mapping: MAPPING,
  dateOptions: DATES,
  settings: SETTINGS,
  supplierDecisions: { "acme trader": { action: "existing", vendorId: acmeId, remember: true } },
  categoryDecisions: {},
  skipRows: [],
  includeDuplicates: false,
  ...over,
});

beforeAll(async () => {
  org = await createTempOrg("ZZ Expense Import");
  const [rent] = await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "5100")));
  rentName = rent.name;
  [{ id: acmeId }] = await db.insert(vendors).values({ tenantId: org.tenantId, name: "Acme Traders", openingBalance: "0" }).returning({ id: vendors.id });
});
afterAll(async () => {
  await org.remove();
});

describe("import expenses", () => {
  it("finds the columns and reviews every row", async () => {
    const a = await analyzeExpenseFile(org.tenantId, { fileName: "e.csv", base64: b64(csv(rentName)) });
    expect(a).toMatchObject({ rowCount: 4, mappingComplete: true });
    const r = await reviewExpenseFile(org.tenantId, { fileName: "e.csv", base64: b64(csv(rentName)), mapping: MAPPING, dateOptions: DATES, settings: SETTINGS });
    const row = (n: number) => r.rows.find((x) => x.rowNumber === n)!;
    expect(row(2)).toMatchObject({ status: "ready", total: 1000 });
    expect(row(3)).toMatchObject({ status: "attention", issues: ["supplier"] });
    expect(row(4)).toMatchObject({ status: "ready", supplierName: null, paid: 200 });
    expect(row(5)).toMatchObject({ status: "attention", issues: ["category"] });
  });

  it("check only changes nothing, then posts in slices, remembers, and refuses a repeat", { timeout: 300000 }, async () => {
    const check = await checkExpenseImport(org.tenantId, runInput());
    expect(check).toMatchObject({ wouldImport: 3, total: 1700 });
    expect(await db.select().from(expenses).where(eq(expenses.tenantId, org.tenantId))).toHaveLength(0);

    const ctx = { tenantId: org.tenantId, userId: org.userId };
    const input = runInput();
    const prep = await prepareExpenseImport(ctx, input);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.rowNumbers).toEqual([2, 3, 4]);
    for (let i = 0; i < prep.rowNumbers.length; i += 2) {
      const c = await importExpenseChunk(ctx, { ...input, supplierDecisions: prep.supplierDecisions, importId: prep.importId, rowNumbers: prep.rowNumbers.slice(i, i + 2) });
      expect(c).toMatchObject({ ok: true, stopped: null });
    }
    expect(await finishExpenseImport(ctx, { importId: prep.importId, stopped: false })).toMatchObject({ imported: 3, total: 1700 });

    const rows = await db.select().from(expenses).where(eq(expenses.importId, prep.importId));
    expect(rows).toHaveLength(3);
    expect(rows.find((e) => Number(e.total) === 200)).toMatchObject({ status: "paid", vendorId: null });
    const [imp] = await db.select().from(expenseImports).where(eq(expenseImports.id, prep.importId));
    expect(imp).toMatchObject({ expenseCount: 3, status: "completed", rowCount: 4 });
    expect(await importExpenseIds(org.tenantId, prep.importId)).toHaveLength(3);
    expect((await db.select().from(supplierAliases).where(eq(supplierAliases.tenantId, org.tenantId))).map((a) => a.alias)).toEqual(["acme trader"]);

    const again = await prepareExpenseImport(ctx, runInput());
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to import/) });
  });
});
