import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetCategories, assetDisposals, assetEvents, assets, journalEntries, journalLines, tenants, tenantTaxRegistrations } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { getSalesRegister } from "@/lib/compliance/reports";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { cashFlowStatement } from "@/lib/ledger/reports";
import { disposeAsset, reverseAssetDisposal } from "./disposal";
import { assetLedgerReconciliation, recordOpeningAsset } from "./opening";
import { postDepreciationRun } from "./run";
import { ensureAssetSetup } from "./setup";

let org: Awaited<ReturnType<typeof createTempOrg>>;
let categoryId: string;
let cashId: string;
const AD = "AD" as const;
const DAY = "2026-10-02";

const acct = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, code))))[0];
async function balance(code: string) {
  const a = await acct(code);
  const lines = await db
    .select({ d: journalLines.debitAmount, c: journalLines.creditAmount })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalLines.accountId, a.id)));
  return Math.round(lines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0) * 100) / 100;
}
const assetNamed = async (name: string) => (await db.select().from(assets).where(and(eq(assets.tenantId, org.tenantId), eq(assets.name, name))))[0];

async function addAsset(name: string, cost: number, months: number, start: string) {
  const r = await recordOpeningAsset(org.tenantId, org.userId, { name, categoryId, originalPurchaseDate: "2020-01-15", cost, accumulatedDepreciation: 0, method: "straight_line", originalUsefulLifeMonths: months, remainingUsefulLifeMonths: months, residualValue: 0, depreciationStartDate: start });
  if (!r.ok) throw new Error(r.error);
}

beforeAll(async () => {
  org = await createTempOrg("ZZ Asset Disposal");
  await db.update(tenants).set({ fiscalYearStartDate: "2026-07-01" }).where(eq(tenants.id, org.tenantId));
  await ensureAssetSetup(org.tenantId);
  categoryId = (await db.select().from(assetCategories).where(eq(assetCategories.tenantId, org.tenantId)))[0].id;
  cashId = (await acct("1000")).id;
  await addAsset("Asset A", 120000, 12, "2026-07-10"); // 10,000 a month
  await addAsset("Asset B", 60000, 6, "2026-08-05"); // 10,000 a month
  expect(await postDepreciationRun(org.tenantId, org.userId, AD, "2026-08-01")).toMatchObject({ ok: true });
});
afterAll(async () => {
  await org.remove();
});

describe("selling, disposing of and writing off assets", () => {
  it("won't let an asset leave while depreciation is behind or already posted past the date", async () => {
    const a = await assetNamed("Asset A");
    const base = { assetId: a.id, kind: "sale" as const, salePrice: 1000, receivedAccountId: cashId };
    expect(await disposeAsset(org.tenantId, org.userId, AD, { ...base, disposalDate: "2026-08-20" })).toMatchObject({ ok: false, error: expect.stringMatching(/already posted through/) });
    expect(await disposeAsset(org.tenantId, org.userId, AD, { ...base, disposalDate: DAY })).toMatchObject({ ok: false, error: expect.stringMatching(/Post depreciation through/) });
    expect(await disposeAsset(org.tenantId, org.userId, AD, { ...base, disposalDate: "2019-01-01" })).toMatchObject({ ok: false });
    expect(await disposeAsset(org.tenantId, org.userId, AD, { ...base, disposalDate: "2999-01-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    expect(await postDepreciationRun(org.tenantId, org.userId, AD, "2026-09-01")).toMatchObject({ ok: true });
  });

  it("a sale above book value books a gain, takes the asset off and feeds cash flow", async () => {
    const a = await assetNamed("Asset A"); // cost 120,000, depreciated 30,000 -> book value 90,000
    const r = await disposeAsset(org.tenantId, org.userId, AD, { assetId: a.id, kind: "sale", disposalDate: DAY, salePrice: 100000, receivedAccountId: cashId, taxable: false });
    expect(r).toMatchObject({ ok: true, gainLoss: 10000 });
    expect(await balance("1000")).toBe(100000);
    expect(await balance("4150")).toBe(-10000);
    expect(await assetNamed("Asset A")).toMatchObject({ status: "sold" });
    const events = await db.select().from(assetEvents).where(and(eq(assetEvents.assetId, a.id), eq(assetEvents.eventType, "sold")));
    expect(events).toHaveLength(1);
    expect((await getSalesRegister(org.tenantId, "2026-10-01", "2026-10-05")).rows).toHaveLength(1);

    const cf = await cashFlowStatement(org.tenantId, new Date("2026-01-01"), new Date("2026-10-06"));
    expect(cf.isBalanced).toBe(true);
    expect(cf.operating.find((l) => l.name === "Gain on disposal of assets")?.amount).toBe(-10000);
  });

  it("an asset that is gone can't be sold again, and the sale can be reversed", async () => {
    const a = await assetNamed("Asset A");
    expect(await disposeAsset(org.tenantId, org.userId, AD, { assetId: a.id, kind: "write_off", disposalDate: DAY, reason: "x" })).toMatchObject({ ok: false, error: expect.stringMatching(/is sold/) });

    const [row] = await db.select().from(assetDisposals).where(eq(assetDisposals.assetId, a.id));
    expect(await reverseAssetDisposal(org.tenantId, org.userId, row.id)).toEqual({ ok: true });
    expect(await assetNamed("Asset A")).toMatchObject({ status: "active" });
    expect(await balance("1000")).toBe(0);
    expect(await balance("4150")).toBe(0);
    expect(await balance("1500")).toBe(180000);
    expect(await reverseAssetDisposal(org.tenantId, org.userId, row.id)).toMatchObject({ ok: false });
    expect((await getSalesRegister(org.tenantId, "2026-10-01", "2026-10-05")).rows).toHaveLength(0);
  });

  it("a sale below book value with VAT books a loss and the output VAT, which reaches the VAT register", async () => {
    await db.insert(tenantTaxRegistrations).values({ tenantId: org.tenantId, taxTypeKey: "vat", status: "active" });
    const rate = await getTaxRate(org.tenantId, "vat", DAY);
    const vat = Math.round(50000 * (rate / 100) * 100) / 100;
    const a = await assetNamed("Asset A");
    const r = await disposeAsset(org.tenantId, org.userId, AD, { assetId: a.id, kind: "sale", disposalDate: DAY, salePrice: 50000, taxable: true, receivedAccountId: cashId, invoiceNumber: "INV-1" });
    expect(r).toMatchObject({ ok: true, gainLoss: -40000 });
    expect(await balance("1000")).toBe(50000 + vat);
    expect(await balance("5600")).toBe(40000);
    expect(await balance("2100")).toBe(-vat);
    const register = await getSalesRegister(org.tenantId, "2026-10-01", "2026-10-05");
    expect(register.rows[0]).toMatchObject({ invoiceNumber: "INV-1" });
    expect(register.totalTax).toBe(vat);
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);
  });

  it("a write-off needs a reason and loses the whole book value", async () => {
    const b = await assetNamed("Asset B"); // cost 60,000, depreciated 20,000 -> 40,000
    expect(await disposeAsset(org.tenantId, org.userId, AD, { assetId: b.id, kind: "write_off", disposalDate: DAY, reason: " " })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/) });
    const lossBefore = await balance("5600");
    expect(await disposeAsset(org.tenantId, org.userId, AD, { assetId: b.id, kind: "write_off", disposalDate: DAY, reason: "Fire" })).toMatchObject({ ok: true, gainLoss: -40000 });
    expect((await balance("5600")) - lossBefore).toBe(40000);
    expect(await assetNamed("Asset B")).toMatchObject({ status: "written_off" });
    const entries = await db.select().from(journalEntries).where(and(eq(journalEntries.tenantId, org.tenantId), eq(journalEntries.sourceType, "asset_writeoff")));
    expect(entries.length).toBeGreaterThan(0);
    expect((await assetLedgerReconciliation(org.tenantId)).matches).toBe(true);

    const cf = await cashFlowStatement(org.tenantId, new Date("2026-01-01"), new Date("2026-10-06"));
    expect(cf.isBalanced).toBe(true);
  });
});
