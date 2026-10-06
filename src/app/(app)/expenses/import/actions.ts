"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { inputVatClaimable } from "@/lib/purchases/vat";
import { getCurrentTaxRate } from "@/lib/compliance/tax-rates";
import { analyzeExpenseFile, buildExpenseTemplate, checkExpenseImport, finishExpenseImport, importExpenseChunk, importExpenseIds, listExpenseImports, markExpenseImportUndone, prepareExpenseImport, reviewExpenseFile } from "@/lib/expenses/import/service";
import type { ExpenseColumnMapping } from "@/lib/expenses/import/fields";
import type { ExpenseCheckResult, ExpenseDateOptions, ExpenseFileAnalysis, ExpenseImportSettings, ExpenseOverrides, ExpenseReviewResult, ExpenseRunInput } from "@/lib/expenses/import/types";
import type { ChunkResult, FinishedImport, PreparedImport } from "@/lib/purchases/import/types";
import { voidExpense } from "../actions";

// Import Expenses: every step needs permission to create expenses (undoing an import needs permission to void them).

export async function getExpenseImportSetup() {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  const [groups, history, categories, supplierList, claimable, vatRate] = await Promise.all([
    getCashBankAccounts(session.tenantId),
    listExpenseImports(session.tenantId),
    getExpenseCategoryAccounts(session.tenantId),
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
    canUndo: can(session, "expenses", "void"),
  };
}
export type ExpenseImportSetup = Awaited<ReturnType<typeof getExpenseImportSetup>>;

export async function analyzeExpenses(input: { fileName: string; base64: string }): Promise<ExpenseFileAnalysis> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  return analyzeExpenseFile(session.tenantId, input);
}

export async function reviewExpenses(input: { fileName: string; base64: string; mapping: ExpenseColumnMapping; dateOptions: ExpenseDateOptions; settings: ExpenseImportSettings; overrides?: ExpenseOverrides }): Promise<ExpenseReviewResult> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  return reviewExpenseFile(session.tenantId, input);
}

/** Everything an import would do, with nothing created or posted. */
export async function checkExpenses(input: ExpenseRunInput): Promise<ExpenseCheckResult> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  return checkExpenseImport(session.tenantId, input);
}

// Posting runs in steps (prepare, slices, finish). A rule from a shared check is a message for the person, not a crash.
const asMessage = (e: unknown): string | null => (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype ? e.message : null);

export async function prepareExpenses(input: ExpenseRunInput): Promise<PreparedImport> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) return { ok: false, error: "You don't have permission to import expenses." };
  try {
    return await prepareExpenseImport({ tenantId: session.tenantId, userId: session.userId }, input);
  } catch (e) {
    const m = asMessage(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}

export async function importExpensesChunk(input: ExpenseRunInput & { importId: string; rowNumbers: number[] }): Promise<ChunkResult> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) return { ok: false, error: "You don't have permission to import expenses." };
  try {
    return await importExpenseChunk({ tenantId: session.tenantId, userId: session.userId }, input);
  } catch (e) {
    const m = asMessage(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}

export async function finishExpenses(input: { importId: string; stopped: boolean }): Promise<FinishedImport | null> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  const done = await finishExpenseImport({ tenantId: session.tenantId, userId: session.userId }, input);
  for (const p of ["/expenses", "/suppliers", "/dashboard", "/journal", "/payments"]) revalidatePath(p);
  return done;
}

/** Voids every expense of an import that can still be voided (one with a payment recorded later stays, and is reported). */
export async function undoExpenseImport(importId: string): Promise<{ ok: true; voided: number; kept: { number: string; reason: string }[] } | { ok: false; error: string }> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "void")) return { ok: false, error: "You don't have permission to void expenses." };
  const list = await importExpenseIds(session.tenantId, importId);
  if (!list) return { ok: false, error: "Import not found." };

  let voided = 0;
  const kept: { number: string; reason: string }[] = [];
  for (const x of list) {
    const fd = new FormData();
    fd.set("expenseId", x.id);
    try {
      await voidExpense(fd);
      voided++;
    } catch (e) {
      kept.push({ number: x.number, reason: e instanceof Error ? e.message : "Could not be voided" });
    }
  }
  await markExpenseImportUndone(session.tenantId, importId);
  for (const p of ["/expenses", "/suppliers", "/dashboard", "/journal"]) revalidatePath(p);
  return { ok: true, voided, kept };
}

export async function downloadExpenseTemplate(): Promise<{ fileName: string; base64: string }> {
  const session = await requireTenantSession();
  if (!can(session, "expenses", "create")) throw new Error("Not permitted");
  return { fileName: "expense-import-template.xlsx", base64: await buildExpenseTemplate(session.tenantId) };
}
