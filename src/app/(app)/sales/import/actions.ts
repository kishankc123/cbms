"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireTenantSession, can } from "@/lib/session";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { salesVatRate } from "@/lib/sales/vat";
import { analyzeSalesFile, buildSalesTemplate, importInvoiceIds, listSalesImports, markImportUndone, reviewSalesFile, runSalesImport } from "@/lib/sales/import/service";
import type { DateOptions, FileAnalysis, ImportSettings, ReviewResult, RunInput, RunResult } from "@/lib/sales/import/types";
import type { SalesColumnMapping } from "@/lib/sales/import/fields";
import { voidInvoice } from "../actions";

// Import Sales: every step needs permission to create sales (undoing an import needs permission to void them).

export async function getImportSetup() {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");
  const [groups, history, vatRate, customerList] = await Promise.all([
    getCashBankAccounts(session.tenantId),
    listSalesImports(session.tenantId),
    salesVatRate(session.tenantId),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, session.tenantId)).orderBy(asc(customers.name)),
  ]);
  return {
    vatRate,
    customers: customerList,
    accounts: groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }])).map((a) => ({ id: a.id, name: a.name })),
    history,
    canUndo: can(session, "sales", "void"),
  };
}
export type ImportSetup = Awaited<ReturnType<typeof getImportSetup>>;

export async function analyzeFile(input: { fileName: string; base64: string }): Promise<FileAnalysis> {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");
  return analyzeSalesFile(session.tenantId, input);
}

export async function reviewFile(input: { fileName: string; base64: string; mapping: SalesColumnMapping; dateOptions: DateOptions; settings: ImportSettings }): Promise<ReviewResult> {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");
  return reviewSalesFile(session.tenantId, input);
}

export async function runImport(input: RunInput): Promise<RunResult> {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) return { ok: false, error: "You don't have permission to import sales." };
  try {
    const result = await runSalesImport({ tenantId: session.tenantId, userId: session.userId }, input);
    if (result.ok) for (const p of ["/sales", "/sales/invoices", "/dashboard", "/journal", "/customers", "/payments"]) revalidatePath(p);
    return result;
  } catch (e) {
    // A rule from a shared check (closed period, no revenue account...) is a message for the person, not a crash.
    if (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype) return { ok: false, error: e.message };
    throw e;
  }
}

/** Voids every invoice of an import that can still be voided (one with a payment recorded later stays, and is reported). */
export async function undoImport(importId: string): Promise<{ ok: true; voided: number; kept: { number: string; reason: string }[] } | { ok: false; error: string }> {
  const session = await requireTenantSession();
  if (!can(session, "sales", "void")) return { ok: false, error: "You don't have permission to void invoices." };
  const invoices = await importInvoiceIds(session.tenantId, importId);
  if (!invoices) return { ok: false, error: "Import not found." };

  let voided = 0;
  const kept: { number: string; reason: string }[] = [];
  for (const inv of invoices) {
    const fd = new FormData();
    fd.set("invoiceId", inv.id);
    try {
      await voidInvoice(fd);
      voided++;
    } catch (e) {
      kept.push({ number: inv.number, reason: e instanceof Error ? e.message : "Could not be voided" });
    }
  }
  await markImportUndone(session.tenantId, importId);
  revalidatePath("/sales");
  revalidatePath("/sales/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/customers");
  return { ok: true, voided, kept };
}

export async function downloadTemplate(): Promise<{ fileName: string; base64: string }> {
  const session = await requireTenantSession();
  if (!can(session, "sales", "create")) throw new Error("Not permitted");
  return { fileName: "sales-import-template.xlsx", base64: await buildSalesTemplate(session.tenantId) };
}
