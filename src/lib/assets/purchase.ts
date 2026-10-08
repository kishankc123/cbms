import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assetCategories, assetEvents, assetLocations, assets, purchaseBills, vendors } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { validateADDate, todayIso } from "@/lib/calendar";
import { postJournalEntry, reverseAllActiveEntriesForSource, type PostLineInput } from "@/lib/ledger/post";
import { findControlAccount } from "@/lib/ledger/control-accounts";
import { getOrCreateSupplierPayableAccountId } from "@/lib/ledger/subledger-accounts";
import { assertCashBankAccounts, assertNoLaterPayments, assertSupplierOwned } from "@/lib/ledger/account-guards";
import { autoApplyAdvance } from "@/lib/ledger/advance-applications";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { assertBillNumberFree, deleteEmbeddedPaymentsForBill, discardBill, insertEmbeddedSupplierPayment } from "@/lib/purchases/bill-records";
import { nextFreeInvoiceNumber } from "@/lib/sales/invoice-numbering";
import { ASSET_ROLES, getAssetAccount } from "./accounts";
import { nextAssetCode } from "./next-code";
import { assetPurchaseAmounts } from "./amounts";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AssetBillType = "vat" | "pan" | "estimate" | "challan" | "no_bill";
export type AssetPurchaseInput = {
  name: string;
  description?: string;
  categoryId: string;
  locationId?: string | null;
  /** Leave empty to number it automatically. */
  assetCode?: string;
  purchaseDate: string;
  availableForUseDate: string;
  vendorId: string;
  invoiceNumber?: string;
  purchaseOrderNumber?: string;
  purchaseReference?: string;
  supportingDocument?: string;
  billType: AssetBillType;
  purchasePrice: number;
  freightCost: number;
  installationCost: number;
  otherCost: number;
  method: "straight_line" | "declining_balance" | "none";
  usefulLifeMonths: number | null;
  residualValue: number;
  depreciationStartDate: string | null;
  payments: { accountId: string; amount: number; modeId?: string | null }[];
};
export type AssetPurchaseResult = { ok: true; assetId: string; assetCode: string; billId: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};

/**
 * Buys a fixed asset in one step: the supplier bill, its ledger entry (Dr Fixed Assets, Dr Tax Receivable when the VAT is
 * claimable; Cr the supplier for what is unpaid and Cr cash/bank for what is paid), the payment record, and the asset
 * itself with its timeline. Everything is checked first; a failure part-way leaves nothing behind.
 */
export async function recordAssetPurchase(tenantId: string, userId: string, input: AssetPurchaseInput): Promise<AssetPurchaseResult> {
  try {
    return await recordAssetPurchaseUnchecked(tenantId, userId, input);
  } catch (e) {
    // A rule from a shared check (closed period, supplier not found...) is a message for the person, not a crash.
    if (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype) return fail(e.message);
    throw e;
  }
}

async function recordAssetPurchaseUnchecked(tenantId: string, userId: string, input: AssetPurchaseInput): Promise<AssetPurchaseResult> {
  const name = input.name.trim();
  if (!name) return fail("Enter the asset name.");
  if (!input.categoryId) return fail("Choose an asset category.");
  if (!input.vendorId) return fail("Select the supplier you bought this asset from.");
  if (!input.purchaseDate || !validateADDate(input.purchaseDate)) return fail("Enter the purchase date.");
  if (!input.availableForUseDate || !validateADDate(input.availableForUseDate)) return fail("Enter the date the asset became available for use.");
  if (input.availableForUseDate < input.purchaseDate) return fail("The available-for-use date can't be before the purchase date.");
  if (!(input.purchasePrice > 0)) return fail("Enter the purchase price.");
  for (const [label, v] of [["freight", input.freightCost], ["installation", input.installationCost], ["other cost", input.otherCost]] as const) {
    if (!(v >= 0)) return fail(`The ${label} can't be negative.`);
  }

  const [category] = await db.select().from(assetCategories).where(and(eq(assetCategories.id, input.categoryId), eq(assetCategories.tenantId, tenantId))).limit(1);
  if (!category) return fail("Choose an asset category.");
  if (!category.isActive) return fail(`The category "${category.name}" is inactive; choose an active one.`);
  if (input.locationId) {
    const [location] = await db.select().from(assetLocations).where(and(eq(assetLocations.id, input.locationId), eq(assetLocations.tenantId, tenantId))).limit(1);
    if (!location || !location.isActive) return fail("Choose an active location.");
  }

  const vatRate = input.billType === "vat" ? await getTaxRate(tenantId, "vat", input.purchaseDate) : 0;
  const claimable = await inputVatClaimable(tenantId);
  const { base, vat, capitalizedCost, total } = assetPurchaseAmounts(input, vatRate, claimable);

  const depreciated = input.method !== "none";
  if (depreciated && !(Number.isInteger(input.usefulLifeMonths) && input.usefulLifeMonths! >= 1 && input.usefulLifeMonths! <= 1200)) return fail("Enter the useful life (at least one month).");
  if (!(input.residualValue >= 0) || input.residualValue > capitalizedCost) return fail("The residual value must be between 0 and the asset's cost.");
  const startDate = depreciated ? input.depreciationStartDate || input.availableForUseDate : null;
  if (depreciated && !validateADDate(startDate!)) return fail("Enter a valid depreciation start date.");

  const paid = round2(input.payments.filter((p) => p.accountId && p.amount > 0).reduce((s, p) => s + p.amount, 0));
  if (paid > total + 0.004) return fail(`The payments (${paid.toFixed(2)}) can't exceed the invoice total (${total.toFixed(2)}).`);
  const remaining = round2(Math.max(total - paid, 0));
  await assertSupplierOwned(tenantId, input.vendorId);
  await assertCashBankAccounts(tenantId, input.payments.filter((p) => p.amount > 0).map((p) => p.accountId));
  await assertPeriodOpen(tenantId, input.purchaseDate);

  // The supplier's bill number is unique per supplier; a missing one is numbered AUTO-n like other bills.
  let billNumber = (input.invoiceNumber ?? "").trim();
  if (billNumber) await assertBillNumberFree(tenantId, input.vendorId, billNumber);
  else {
    const existing = await db.select({ n: purchaseBills.billNumber }).from(purchaseBills).where(eq(purchaseBills.tenantId, tenantId));
    const taken = new Set(existing.map((r) => r.n));
    billNumber = nextFreeInvoiceNumber(taken, (n) => `AUTO-${n}`, taken.size + 1).number;
  }

  const costAccount = await getAssetAccount(tenantId, ASSET_ROLES.cost);
  let taxReceivableId: string | null = null;
  if (vat > 0 && claimable) {
    const taxReceivable = await findControlAccount(tenantId, ["1300"], "Tax Receivable");
    if (!taxReceivable) return fail("No Tax Receivable account found — add one to the Chart of Accounts first.");
    taxReceivableId = taxReceivable.id;
  }
  const payableId = remaining > 0 ? await getOrCreateSupplierPayableAccountId(tenantId, input.vendorId) : null;

  // 1. Reserve the asset (and its code) first, as a draft, so a clash is settled before anything is posted.
  const manualCode = (input.assetCode ?? "").trim();
  let asset: typeof assets.$inferSelect | undefined;
  for (let attempt = 0; attempt < 4 && !asset; attempt++) {
    const assetCode = manualCode || (await nextAssetCode(tenantId, attempt));
    try {
      [asset] = await db
        .insert(assets)
        .values({
          tenantId,
          assetCode,
          name,
          description: input.description?.trim() || null,
          categoryId: input.categoryId,
          locationId: input.locationId || null,
          status: "draft",
          source: "purchase",
          purchaseDate: input.purchaseDate,
          availableForUseDate: input.availableForUseDate,
          vendorId: input.vendorId,
          invoiceNumber: billNumber,
          purchaseOrderNumber: input.purchaseOrderNumber?.trim() || null,
          purchaseReference: input.purchaseReference?.trim() || null,
          supportingDocument: input.supportingDocument?.trim() || null,
          purchasePrice: input.purchasePrice.toFixed(2),
          vatAmount: vat.toFixed(2),
          freightCost: input.freightCost.toFixed(2),
          installationCost: input.installationCost.toFixed(2),
          otherCost: input.otherCost.toFixed(2),
          capitalizedCost: capitalizedCost.toFixed(2),
          depreciationMethod: input.method,
          usefulLifeMonths: depreciated ? input.usefulLifeMonths : null,
          residualValue: (depreciated ? input.residualValue : 0).toFixed(2),
          depreciationStartDate: startDate,
          createdBy: userId,
        })
        .returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (manualCode) return fail(`Asset code ${manualCode} is already used.`);
    }
  }
  if (!asset) return fail("Could not allocate an asset code; please try again.");

  // 2. The supplier bill, then its ledger entry.
  const [bill] = await db
    .insert(purchaseBills)
    .values({
      tenantId,
      vendorId: input.vendorId,
      billNumber,
      billDate: input.purchaseDate,
      billType: input.billType,
      description: `Fixed asset ${asset.assetCode} — ${name}`.slice(0, 200),
      lineItems: [{ itemId: null, description: name, rate: base, quantity: 1, discount: 0 }],
      subtotal: base.toFixed(2),
      taxAmount: vat.toFixed(2),
      total: total.toFixed(2),
      purchaseType: "asset",
      status: total > 0 && remaining <= 0.004 ? "paid" : paid > 0 ? "partially_paid" : "open",
      amountPaid: paid.toFixed(2),
    })
    .returning();

  try {
    const label = `Asset ${asset.assetCode}`;
    const lines: PostLineInput[] = [{ accountId: costAccount.id, debitAmount: capitalizedCost, description: label }];
    if (taxReceivableId) lines.push({ accountId: taxReceivableId, debitAmount: vat, description: `Tax on ${label}` });
    if (payableId && remaining > 0) lines.push({ accountId: payableId, creditAmount: remaining, description: label });
    for (const p of input.payments.filter((p) => p.accountId && p.amount > 0)) lines.push({ accountId: p.accountId, paymentModeId: p.modeId, creditAmount: round2(p.amount), description: label });

    const entry = await postJournalEntry({
      tenantId,
      entryDate: input.purchaseDate,
      sourceType: "asset_purchase",
      sourceId: bill.id,
      referenceNumber: billNumber,
      memo: `Asset purchase ${asset.assetCode} — ${name}`,
      createdBy: userId,
      lines,
    });
    if (paid > 0) {
      const paymentLines = input.payments.filter((p) => p.accountId && p.amount > 0);
      await insertEmbeddedSupplierPayment(tenantId, userId, input.vendorId, bill.id, input.purchaseDate, paid, paymentLines[0].accountId, entry.id, billNumber, paymentLines[0].modeId);
    }

    // 3. The asset goes live, with its timeline.
    await db.update(assets).set({ status: "active", purchaseBillId: bill.id, updatedAt: new Date() }).where(eq(assets.id, asset.id));
    const [supplier] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
    await db.insert(assetEvents).values([
      { tenantId, assetId: asset.id, eventType: "purchased", eventDate: input.purchaseDate, description: `Purchased from ${supplier?.name ?? "supplier"} (bill ${billNumber})`, amount: capitalizedCost.toFixed(2), journalEntryId: entry.id, createdBy: userId },
      { tenantId, assetId: asset.id, eventType: "available_for_use", eventDate: input.availableForUseDate, description: "Available for use", createdBy: userId },
    ]);
    await logAuditEvent({ tenantId, userId, action: "asset_purchased", entityType: "asset", entityId: asset.id, after: { assetCode: asset.assetCode, name, capitalizedCost, billNumber } });
  } catch (e) {
    await discardBill(tenantId, bill.id, userId);
    await db.delete(assets).where(eq(assets.id, asset.id));
    throw e;
  }

  // Any advance already paid to this supplier goes to their oldest open bills first.
  await autoApplyAdvance(tenantId, userId, "supplier", input.vendorId);
  return { ok: true, assetId: asset.id, assetCode: asset.assetCode, billId: bill.id };
}

/**
 * Cancels a purchase made by mistake: reverses its ledger entries, voids the bill and takes the asset off the register
 * (status "Voided" — the record and its history stay). Only possible before any depreciation, and not while a later payment
 * in Payments still points at the bill.
 */
export async function voidAssetPurchase(tenantId: string, userId: string, assetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const [asset] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId))).limit(1);
    if (!asset) return fail("Asset not found.");
    if (asset.source !== "purchase" || !asset.purchaseBillId) return fail("Only an asset bought through Purchase can be voided here.");
    if (asset.status === "voided") return fail("This purchase has already been voided.");
    if (asset.status !== "active") return fail("Only an active asset can have its purchase voided — a disposed or written-off asset has history that must stay.");
    if (asset.lastDepreciationDate || Number(asset.accumulatedDepreciation) > 0) return fail("Depreciation has been posted for this asset, so its purchase can't be voided.");

    const billId = asset.purchaseBillId;
    await assertNoLaterPayments(tenantId, "purchase_bill", billId, "bill");
    await assertPeriodOpen(tenantId, asset.purchaseDate ?? todayIso());
    await assertPeriodOpen(tenantId, todayIso());

    await reverseAllActiveEntriesForSource(tenantId, billId, userId, `Void of asset purchase ${asset.assetCode}`);
    await deleteEmbeddedPaymentsForBill(tenantId, billId);
    await db.update(purchaseBills).set({ status: "void" }).where(eq(purchaseBills.id, billId));
    await db.update(assets).set({ status: "voided", updatedAt: new Date() }).where(eq(assets.id, asset.id));
    await db.insert(assetEvents).values({ tenantId, assetId: asset.id, eventType: "voided", eventDate: todayIso(), description: "Purchase voided", createdBy: userId });
    await logAuditEvent({ tenantId, userId, action: "asset_purchase_voided", entityType: "asset", entityId: asset.id, before: { status: asset.status }, after: { status: "voided" } });
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype) return fail(e.message);
    throw e;
  }
}
