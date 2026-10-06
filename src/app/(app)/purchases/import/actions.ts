"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCogsSubGroups } from "@/lib/ledger/control-accounts";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { analyzePurchaseFile, buildPurchaseTemplate, checkPurchaseImport, finishPurchaseImport, importBillIds, importPurchaseChunk, listPurchaseImports, markPurchaseImportUndone, preparePurchaseImport, reviewPurchaseFile } from "@/lib/purchases/import/service";
import type { PurchaseColumnMapping } from "@/lib/purchases/import/fields";
import type { ChunkResult, FinishedImport, PreparedImport, PurchaseCheckResult, PurchaseDateOptions, PurchaseFileAnalysis, PurchaseImportSettings, PurchaseOverrides, PurchaseReviewResult, PurchaseRunInput } from "@/lib/purchases/import/types";
import { voidBill } from "../actions";

// Import Purchases: every step needs permission to create purchases (undoing an import needs permission to void them).

export async function getPurchaseImportSetup() {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  const [groups, history, categories, supplierList, claimable, vatRate] = await Promise.all([
    getCashBankAccounts(session.tenantId),
    listPurchaseImports(session.tenantId),
    getCogsSubGroups(session.tenantId),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
    inputVatClaimable(session.tenantId),
    getCurrentTaxRate(session.tenantId, "vat"),
  ]);
  return {
    vatRate,
    vatClaimable: claimable,
    suppliers: supplierList,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    accounts: groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }])).map((a) => ({ id: a.id, name: a.name })),
    history,
    canUndo: can(session, "purchases", "void"),
  };
}
export type PurchaseImportSetup = Awaited<ReturnType<typeof getPurchaseImportSetup>>;

export async function analyzePurchases(input: { fileName: string; base64: string }): Promise<PurchaseFileAnalysis> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  return analyzePurchaseFile(session.tenantId, input);
}

export async function reviewPurchases(input: { fileName: string; base64: string; mapping: PurchaseColumnMapping; dateOptions: PurchaseDateOptions; settings: PurchaseImportSettings; overrides?: PurchaseOverrides }): Promise<PurchaseReviewResult> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  return reviewPurchaseFile(session.tenantId, input);
}

/** Everything an import would do, with nothing created or posted. */
export async function checkPurchases(input: PurchaseRunInput): Promise<PurchaseCheckResult> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  return checkPurchaseImport(session.tenantId, input);
}

// An import runs in steps so a long file never has to fit inside one request: prepare (create what was ticked, list the rows),
// then the rows in small slices, then finish. A rule from a shared check is a message for the person, not a crash.
const asMessage = (e: unknown): string | null => (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype ? e.message : null);

export async function preparePurchases(input: PurchaseRunInput): Promise<PreparedImport> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) return { ok: false, error: "You don't have permission to import purchases." };
  try {
    return await preparePurchaseImport({ tenantId: session.tenantId, userId: session.userId }, input);
  } catch (e) {
    const m = asMessage(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}

export async function importPurchasesChunk(input: PurchaseRunInput & { importId: string; rowNumbers: number[] }): Promise<ChunkResult> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) return { ok: false, error: "You don't have permission to import purchases." };
  try {
    return await importPurchaseChunk({ tenantId: session.tenantId, userId: session.userId }, input);
  } catch (e) {
    const m = asMessage(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}

export async function finishPurchases(input: { importId: string; stopped: boolean }): Promise<FinishedImport | null> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  const done = await finishPurchaseImport({ tenantId: session.tenantId, userId: session.userId }, input);
  for (const p of ["/purchases/consumable", "/suppliers", "/dashboard", "/journal", "/payments"]) revalidatePath(p);
  return done;
}

/** Voids every bill of an import that can still be voided (one with a payment recorded later stays, and is reported). */
export async function undoPurchaseImport(importId: string): Promise<{ ok: true; voided: number; kept: { number: string; reason: string }[] } | { ok: false; error: string }> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "void")) return { ok: false, error: "You don't have permission to void bills." };
  const bills = await importBillIds(session.tenantId, importId);
  if (!bills) return { ok: false, error: "Import not found." };

  let voided = 0;
  const kept: { number: string; reason: string }[] = [];
  for (const b of bills) {
    const fd = new FormData();
    fd.set("billId", b.id);
    try {
      await voidBill(fd);
      voided++;
    } catch (e) {
      kept.push({ number: b.number, reason: e instanceof Error ? e.message : "Could not be voided" });
    }
  }
  await markPurchaseImportUndone(session.tenantId, importId);
  for (const p of ["/purchases/consumable", "/suppliers", "/dashboard", "/journal"]) revalidatePath(p);
  return { ok: true, voided, kept };
}

export async function downloadPurchaseTemplate(): Promise<{ fileName: string; base64: string }> {
  const session = await requireTenantSession();
  if (!can(session, "purchases", "create")) throw new Error("Not permitted");
  return { fileName: "purchase-import-template.xlsx", base64: await buildPurchaseTemplate(session.tenantId) };
}
