import { buildPaymentResolver, resolvePaymentMode } from "@/lib/payment-modes";
import * as XLSX from "xlsx";
import { expenseColumnGuide, guideSheet } from "@/lib/sales/import/column-guide";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenseImports, expenses, importColumnMappings, supplierAliases, vendors } from "@/db/schema";
import { applyAmountRules, loadAmountRules } from "@/lib/audit-rules";
import { logAuditEvent } from "@/lib/audit";
import { resolveImportDates } from "@/lib/banking/import-dates";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { createExpenseCore } from "@/lib/expenses/expense-records";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import type { CategoryDecision, CategoryGroup, ChunkResult, FinishedImport, PreparedImport, SupplierDecision, SupplierGroup } from "@/lib/purchases/import/types";
import type { CategoryState, SupplierState } from "@/lib/purchases/import/checks";
import { parsePurchaseBillType } from "@/lib/purchases/import/values";
import { headerSignature } from "@/lib/sales/import/fields";
import { bestNameMatch, normalizeName, parseAmountCell } from "@/lib/sales/import/values";
import { checkExpenseRow } from "./checks";
import { EXPENSE_FIELDS, expenseMappingComplete, suggestExpenseMapping, type ExpenseColumnMapping } from "./fields";
import type { ExpenseCheckResult, ExpenseDateOptions, ExpenseFileAnalysis, ExpenseImportSettings, ExpenseOverrides, ExpenseReviewResult, ExpenseReviewRow, ExpenseRunInput } from "./types";

// Import Expenses: reading a spreadsheet of expenses (one row per expense), matching it to suppliers, categories and accounts,
// checking every row (including the organization's own amount rules), and posting the clean ones through the same writer the
// Add Expense form uses. Plain server helpers (not server actions): the actions in expenses/import check the permission first.
// Posting is split into steps (prepare, chunks, finish) so a long file never has to fit inside one request.

const MAX_ROWS = 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const KIND = "expenses";

type Parsed = { headers: string[]; rows: string[][] };

function readFile(base64: string, fileName: string): Parsed {
  const parsed = parseStatementFile(base64, fileName);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) throw new Error("The file has no rows to import.");
  if (parsed.rows.length > MAX_ROWS) throw new Error(`The file has ${parsed.rows.length} rows. Import up to ${MAX_ROWS} at a time.`);
  return parsed;
}

const colIndex = (headers: string[], name: string | undefined) => (name ? headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase()) : -1);

function datesFor(parsed: Parsed, column: string | undefined, opts: ExpenseDateOptions, allowMixed = opts.allowMixed) {
  const idx = colIndex(parsed.headers, column);
  return resolveImportDates(parsed.rows.map((r) => (idx >= 0 ? r[idx] : undefined)), { header: column, choice: opts.choice, dayFirst: opts.dayFirst, allowMixed });
}

const datesSummary = (d: ReturnType<typeof resolveImportDates>): ExpenseFileAnalysis["dates"] => ({ detected: d.detected, confidence: d.confidence, mixed: d.mixed, blocking: d.blocking, problemCount: d.problemCount, dayMonthAmbiguity: d.hasDayMonthAmbiguity });

// ------------------------------------------------------------------ step 1: what is in the file

export async function analyzeExpenseFile(tenantId: string, input: { fileName: string; base64: string }): Promise<ExpenseFileAnalysis> {
  const parsed = readFile(input.base64, input.fileName);
  const signature = headerSignature(parsed.headers);
  const [remembered] = await db.select().from(importColumnMappings).where(and(eq(importColumnMappings.tenantId, tenantId), eq(importColumnMappings.kind, KIND), eq(importColumnMappings.signature, signature))).limit(1);
  const known = remembered?.mapping as ExpenseColumnMapping | undefined;
  const usable = known && Object.values(known).every((h) => colIndex(parsed.headers, h) >= 0);
  const mapping = usable ? known! : suggestExpenseMapping(parsed.headers);
  const dates = datesFor(parsed, mapping.date, { choice: "auto", dayFirst: true, allowMixed: false });
  return { headers: parsed.headers, sample: parsed.rows.slice(0, 5), rowCount: parsed.rows.length, mapping, remembered: Boolean(usable), mappingComplete: expenseMappingComplete(mapping), dates: datesSummary(dates) };
}

// ------------------------------------------------------------------ step 2: every row, checked

type Row = ExpenseReviewRow & { vendorId: string | null; newSupplierName: string | null; categoryId: string | null; taxable: number; vat: number; tds: number; accountId: string | null; modeId: string | null; invoiceNumber: string; description: string; dueDate: string };
type Category = { id: string; code: string; name: string };

async function cashBankAccountList(tenantId: string) {
  return (await buildPaymentResolver(tenantId)).accounts;
}

/** Puts the corrections typed in the review over the file's cells; a field the file has no column for gets one of its own. */
function applyOverrides(parsed: Parsed, mapping: ExpenseColumnMapping, overrides: ExpenseOverrides): { parsed: Parsed; mapping: ExpenseColumnMapping } {
  const valid = new Set<string>(EXPENSE_FIELDS.map((f) => f.key));
  const keys = new Set<string>();
  for (const o of Object.values(overrides)) for (const k of Object.keys(o)) if (valid.has(k)) keys.add(k);
  if (keys.size === 0) return { parsed, mapping };

  const headers = [...parsed.headers];
  const m: ExpenseColumnMapping = { ...mapping };
  for (const k of keys as Set<keyof ExpenseColumnMapping>) {
    if (!m[k] || colIndex(headers, m[k]) < 0) {
      m[k] = `__edit_${String(k)}`;
      headers.push(m[k]!);
    }
  }
  const rows = parsed.rows.map((r, i) => {
    const o = overrides[i + 2];
    if (!o) return r;
    const copy = [...r];
    while (copy.length < headers.length) copy.push("");
    for (const [k, v] of Object.entries(o)) if (valid.has(k)) copy[colIndex(headers, m[k as keyof ExpenseColumnMapping])] = String(v ?? "").slice(0, 200);
    return copy;
  });
  return { parsed: { headers, rows }, mapping: m };
}

async function buildRows(
  tenantId: string,
  parsedIn: Parsed,
  mappingIn: ExpenseColumnMapping,
  dateOptions: ExpenseDateOptions,
  settings: ExpenseImportSettings,
  supplierDecisions: Record<string, SupplierDecision>,
  categoryDecisions: Record<string, CategoryDecision>,
  skipRows: Set<number>,
  overrides: ExpenseOverrides = {},
  opts: { skipDuplicateCheck?: boolean } = {}
) {
  const { parsed, mapping } = applyOverrides(parsedIn, mappingIn, overrides);
  for (const f of EXPENSE_FIELDS.filter((x) => x.required)) if (colIndex(parsed.headers, mapping[f.key]) < 0) throw new Error(`Choose the column that holds the ${f.label.toLowerCase()}.`);
  const idx = Object.fromEntries(EXPENSE_FIELDS.map((f) => [f.key, colIndex(parsed.headers, mapping[f.key])])) as Record<(typeof EXPENSE_FIELDS)[number]["key"], number>;
  const cell = (r: string[], k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");

  const dates = datesFor(parsed, mapping.date, dateOptions);
  const dueDates = idx.dueDate >= 0 ? datesFor(parsed, mapping.dueDate, dateOptions, true) : null;
  const [supplierList, aliasRows, categoryList, amountRules] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)),
    db.select({ alias: supplierAliases.alias, vendorId: supplierAliases.vendorId }).from(supplierAliases).where(eq(supplierAliases.tenantId, tenantId)),
    getExpenseCategoryAccounts(tenantId),
    loadAmountRules(tenantId, "expenses"),
  ]);
  const byName = new Map<string, { id: string; name: string }>();
  for (const s of supplierList) if (!byName.has(normalizeName(s.name))) byName.set(normalizeName(s.name), s);
  const byAlias = new Map(aliasRows.map((a) => [a.alias, a.vendorId]));
  const supplierById = new Map(supplierList.map((s) => [s.id, s]));
  const payResolver = await buildPaymentResolver(tenantId);
  const categoryByText = new Map<string, Category>();
  for (const c of categoryList) {
    categoryByText.set(normalizeName(c.name), c);
    categoryByText.set(normalizeName(c.code), c);
  }
  const categoryById = new Map(categoryList.map((c) => [c.id, c]));

  const lockedByDate = new Map<string, boolean>();
  const vatByDate = new Map<string, number>();
  const isoDates = [...new Set(dates.rows.map((r) => r.iso).filter((d): d is string => Boolean(d)))];
  for (const d of isoDates) {
    lockedByDate.set(d, await assertPeriodOpen(tenantId, d).then(() => false, () => true));
    vatByDate.set(d, await getTaxRate(tenantId, "vat", d));
  }

  const existingByInvoice = new Set<string>();
  const existingByAmount = new Set<string>();
  if (!opts.skipDuplicateCheck && isoDates.length > 0) {
    const from = isoDates.reduce((a, b) => (a < b ? a : b));
    const to = isoDates.reduce((a, b) => (a > b ? a : b));
    const rows = await db
      .select({ vendorId: expenses.vendorId, invoice: expenses.invoiceNumber, date: expenses.expenseDate, total: expenses.total })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), ne(expenses.status, "void")));
    for (const r of rows) {
      if (r.invoice) existingByInvoice.add(`${r.vendorId ?? ""}|${r.invoice.toLowerCase()}`);
      if (r.date >= from && r.date <= to) existingByAmount.add(`${r.date}|${r.vendorId ?? ""}|${Number(r.total).toFixed(2)}`);
    }
  }

  const seenInFile = new Set<string>();
  const out: Row[] = [];
  parsed.rows.forEach((r, i) => {
    const rowNumber = i + 2;
    if (r.every((c) => (c ?? "").trim() === "")) return;
    const d = dates.rows[i];
    const supplierText = cell(r, "supplier");
    const supplierKey = supplierText ? normalizeName(supplierText) : null;

    let vendorId: string | null = null;
    let supplier: SupplierState = "none";
    if (supplierKey) {
      const matched = byName.get(supplierKey)?.id ?? byAlias.get(supplierKey) ?? null;
      const decision = supplierDecisions[supplierKey];
      if (matched) {
        vendorId = matched;
        supplier = "matched";
      } else if (decision?.action === "existing" && supplierById.has(decision.vendorId)) {
        vendorId = decision.vendorId;
        supplier = "matched";
      } else if (decision?.action === "create") supplier = "create";
      else if (decision?.action === "skip") supplier = "skipped";
      else supplier = "unknown";
    }
    if (skipRows.has(rowNumber)) supplier = "skipped";

    const categoryText = cell(r, "category");
    const categoryKey = categoryText ? normalizeName(categoryText) : null;
    let categoryId: string | null = null;
    let category: CategoryState = "none";
    if (categoryKey) {
      const decision = categoryDecisions[categoryKey];
      const matched = categoryByText.get(categoryKey);
      if (matched) {
        categoryId = matched.id;
        category = "ok";
      } else if (decision?.action === "existing" && categoryById.has(decision.categoryId)) {
        categoryId = decision.categoryId;
        category = "ok";
      } else if (decision?.action === "skip") category = "skipped";
      else category = "unknown";
    } else if (settings.defaultCategoryId && categoryById.has(settings.defaultCategoryId)) {
      categoryId = settings.defaultCategoryId;
      category = "ok";
    }

    const accountText = cell(r, "account");
    const accountPick = accountText ? payResolver.resolve(accountText) : null;
    const picked = accountPick && "accountId" in accountPick ? accountPick : null;
    const accountId = picked?.accountId ?? null;
    const accountNote = accountPick && "ambiguous" in accountPick ? `"${accountText}" has more than one account (${accountPick.ambiguous.join(", ")}). Write the account name instead.` : undefined;
    const amount = parseAmountCell(cell(r, "amount"));
    const vat = parseAmountCell(cell(r, "vat"));
    const tds = parseAmountCell(cell(r, "tds"));
    const paid = parseAmountCell(cell(r, "paid"));
    const billTypeText = cell(r, "billType");
    const iso = d?.iso ?? null;
    const invoiceNumber = cell(r, "invoiceNumber");
    const dueText = cell(r, "dueDate");
    const dueIso = dueText && dueDates ? dueDates.rows[i]?.iso ?? null : null;

    const check = checkExpenseRow({
      dateIso: iso,
      dateNote: d?.note ?? (cell(r, "date") ? "The date can't be read." : "There is no date."),
      periodLocked: iso ? lockedByDate.get(iso) ?? false : false,
      dueDate: { text: dueText, iso: dueIso },
      amount,
      billType: parsePurchaseBillType(billTypeText),
      billTypeText,
      vat,
      tds,
      paid,
      account: accountText === "" ? "none" : accountId ? "ok" : "unknown",
      accountText,
      accountNote,
      supplier,
      category,
      categoryText,
      duplicate: false,
      settings: {
        amountsIncludeVat: settings.amountsIncludeVat,
        vatRate: iso ? vatByDate.get(iso) ?? 0 : 0,
        defaultBillType: settings.defaultBillType,
        paidMode: settings.paidMode,
        hasDefaultAccount: Boolean(settings.defaultAccountId),
        blockedBy: (total) => applyAmountRules(amountRules, total).blocked,
      },
    });

    let status = check.status;
    let messages = check.messages;
    if (status === "ready" && !opts.skipDuplicateCheck) {
      const owner = vendorId ?? "";
      const numberKey = `${owner}|${invoiceNumber.toLowerCase()}`;
      const amountKey = iso && check.computed ? `${iso}|${owner}|${check.computed.total.toFixed(2)}` : null;
      if (invoiceNumber && vendorId && existingByInvoice.has(numberKey)) {
        status = "duplicate";
        messages = ["An expense with this invoice number already exists for this supplier."];
      } else if (!invoiceNumber && amountKey && existingByAmount.has(amountKey)) {
        status = "duplicate";
        messages = ["An expense with the same date, supplier and amount already exists."];
      } else if (invoiceNumber && vendorId && seenInFile.has(numberKey)) {
        status = "duplicate";
        messages = ["This invoice number appears earlier in the file for the same supplier."];
      }
      if (invoiceNumber && vendorId) seenInFile.add(numberKey);
    }

    const supplierDecision = supplierKey ? supplierDecisions[supplierKey] : undefined;
    out.push({
      rowNumber,
      raw: Object.fromEntries(EXPENSE_FIELDS.filter((f) => idx[f.key] >= 0).map((f) => [f.key, cell(r, f.key)])),
      dateIso: iso,
      dateRaw: cell(r, "date"),
      supplierText,
      supplierName: vendorId ? supplierById.get(vendorId)?.name ?? null : supplier === "create" && supplierDecision?.action === "create" ? supplierDecision.name : null,
      supplierKey,
      categoryText,
      categoryName: categoryId ? categoryById.get(categoryId)?.name ?? null : null,
      categoryKey,
      amount: amount.value,
      paid: check.computed?.paid ?? 0,
      billType: check.computed?.billType ?? null,
      status,
      issues: check.issues,
      messages,
      total: check.computed?.total ?? null,
      tax: check.computed?.vat ?? null,
      vendorId,
      newSupplierName: supplier === "create" && supplierDecision?.action === "create" ? supplierDecision.name : null,
      categoryId,
      taxable: check.computed?.taxable ?? 0,
      vat: check.computed?.vat ?? 0,
      tds: check.computed?.tds ?? 0,
      accountId: accountId ?? settings.defaultAccountId,
      modeId: picked ? picked.modeId : accountText ? null : settings.defaultModeId ?? null,
      invoiceNumber,
      description: cell(r, "description"),
      dueDate: dueIso ?? "",
    });
  });
  return { rows: out, dates, supplierList, categoryList };
}

export async function reviewExpenseFile(
  tenantId: string,
  input: { base64: string; fileName: string; mapping: ExpenseColumnMapping; dateOptions: ExpenseDateOptions; settings: ExpenseImportSettings; overrides?: ExpenseOverrides }
): Promise<ExpenseReviewResult> {
  const parsed = readFile(input.base64, input.fileName);
  const { rows, dates, supplierList, categoryList } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, input.settings, {}, {}, new Set(), input.overrides);

  const sGroups = new Map<string, SupplierGroup>();
  const cGroups = new Map<string, CategoryGroup>();
  for (const r of rows) {
    if (r.status === "skipped") continue;
    if (r.supplierKey && !r.vendorId) {
      const g = sGroups.get(r.supplierKey) ?? { key: r.supplierKey, text: r.supplierText, rows: 0, total: 0, suggestion: null };
      g.rows++;
      g.total = round2(g.total + (r.total ?? r.amount ?? 0));
      sGroups.set(r.supplierKey, g);
    }
    if (r.categoryKey && !r.categoryId) {
      const g = cGroups.get(r.categoryKey) ?? { key: r.categoryKey, text: r.categoryText, rows: 0, total: 0, suggestion: null };
      g.rows++;
      g.total = round2(g.total + (r.total ?? r.amount ?? 0));
      cGroups.set(r.categoryKey, g);
    }
  }
  for (const g of sGroups.values()) {
    const best = bestNameMatch(g.text, supplierList);
    if (best) g.suggestion = { vendorId: best.match.id, name: best.match.name, score: Math.round(best.score * 100) / 100 };
  }
  for (const g of cGroups.values()) {
    const best = bestNameMatch(g.text, categoryList);
    if (best) g.suggestion = { categoryId: best.match.id, name: best.match.name, score: Math.round(best.score * 100) / 100 };
  }

  const counts = { ready: 0, attention: 0, duplicate: 0, skipped: 0 };
  let importTotal = 0;
  let importTax = 0;
  let fileTotal = 0;
  for (const r of rows) {
    counts[r.status]++;
    fileTotal = round2(fileTotal + (r.amount ?? 0));
    const pending = r.status === "attention" && r.issues.length > 0 && r.issues.every((i) => (i === "supplier" && r.supplierKey !== null) || (i === "category" && r.categoryKey !== null));
    if (r.status === "ready" || pending) {
      importTotal = round2(importTotal + (r.total ?? 0));
      importTax = round2(importTax + (r.tax ?? 0));
    }
  }
  const strip = (r: Row): ExpenseReviewRow => ({
    rowNumber: r.rowNumber, raw: r.raw, dateIso: r.dateIso, dateRaw: r.dateRaw, supplierText: r.supplierText, supplierName: r.supplierName, supplierKey: r.supplierKey,
    categoryText: r.categoryText, categoryName: r.categoryName, categoryKey: r.categoryKey, amount: r.amount, paid: r.paid, billType: r.billType, status: r.status,
    issues: r.issues, messages: r.messages, total: r.total, tax: r.tax,
  });
  return { rows: rows.map(strip), supplierGroups: [...sGroups.values()].sort((a, b) => b.rows - a.rows), categoryGroups: [...cGroups.values()].sort((a, b) => b.rows - a.rows), counts, fileTotal, importTotal, importTax, dates: datesSummary(dates) };
}

// ------------------------------------------------------------------ step 3: import, in steps

function plan(rows: Row[], includeDuplicates: boolean) {
  const importable = rows.filter((r) => (r.status === "ready" || (r.status === "duplicate" && includeDuplicates)) && r.dateIso && r.taxable > 0 && r.categoryId);
  const skipped = rows.filter((r) => !importable.includes(r)).map((r) => ({ rowNumber: r.rowNumber, reason: r.status === "skipped" ? "Skipped" : r.messages[0] ?? "Needs attention" }));
  return { importable, skipped };
}

async function validDecisions(tenantId: string, input: ExpenseRunInput) {
  const own = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const ownIds = new Set(own.map((s) => s.id));
  const byNormName = new Map(own.map((s) => [normalizeName(s.name), s]));
  const categoryIds = new Set((await getExpenseCategoryAccounts(tenantId)).map((c) => c.id));

  const suppliers: Record<string, SupplierDecision> = {};
  const toCreate = new Map<string, { key: string; name: string }>();
  for (const [key, d] of Object.entries(input.supplierDecisions)) {
    if (d.action === "existing") {
      if (ownIds.has(d.vendorId)) suppliers[key] = d;
    } else if (d.action === "skip") suppliers[key] = d;
    else if (d.action === "create") {
      const name = d.name.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!name) continue;
      const same = byNormName.get(normalizeName(name));
      if (same) suppliers[key] = { action: "existing", vendorId: same.id, remember: false };
      else {
        suppliers[key] = { action: "create", name };
        toCreate.set(normalizeName(name), { key, name });
      }
    }
  }
  const categories: Record<string, CategoryDecision> = {};
  for (const [key, d] of Object.entries(input.categoryDecisions)) {
    if (d.action === "skip") categories[key] = d;
    else if (d.action === "existing" && categoryIds.has(d.categoryId)) categories[key] = d;
  }
  return { suppliers, categories, toCreate: [...toCreate.values()], ownIds, defaultCategoryOk: !input.settings.defaultCategoryId || categoryIds.has(input.settings.defaultCategoryId) };
}

/** Everything an import would do, without doing any of it: nothing is created, posted or remembered. */
export async function checkExpenseImport(tenantId: string, input: ExpenseRunInput): Promise<ExpenseCheckResult> {
  const parsed = readFile(input.base64, input.fileName);
  const v = await validDecisions(tenantId, input);
  const settings = { ...input.settings, defaultCategoryId: v.defaultCategoryOk ? input.settings.defaultCategoryId : null };
  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, settings, v.suppliers, v.categories, new Set(input.skipRows), input.overrides);
  const { importable, skipped } = plan(rows, input.includeDuplicates);
  return { wouldImport: importable.length, total: round2(importable.reduce((s, r) => s + (r.total ?? 0), 0)), tax: round2(importable.reduce((s, r) => s + (r.tax ?? 0), 0)), suppliersToCreate: v.toCreate.map((c) => c.name), skipped };
}

export async function prepareExpenseImport(ctx: { tenantId: string; userId: string }, input: ExpenseRunInput): Promise<PreparedImport> {
  const { tenantId, userId } = ctx;
  const parsed = readFile(input.base64, input.fileName);
  const signature = headerSignature(parsed.headers);

  if (input.settings.defaultAccountId && !(await cashBankAccountList(tenantId)).some((a) => a.id === input.settings.defaultAccountId)) return { ok: false, error: "Choose a cash or bank account of this organization." };
  if (input.settings.defaultAccountId && input.settings.defaultModeId) {
    try {
      await resolvePaymentMode(tenantId, input.settings.defaultModeId, input.settings.defaultAccountId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Choose the payment mode and account again." };
    }
  }
  const v = await validDecisions(tenantId, input);
  if (!v.defaultCategoryOk) return { ok: false, error: "Choose an expense category of this organization." };

  const dry = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, input.settings, v.suppliers, v.categories, new Set(input.skipRows), input.overrides);
  if (plan(dry.rows, input.includeDuplicates).importable.length === 0) return { ok: false, error: "There is nothing to import: every row needs attention or was skipped." };

  const created: { id: string; name: string }[] = [];
  const resolved: Record<string, SupplierDecision> = { ...v.suppliers };
  for (const c of v.toCreate) {
    const [s] = await db.insert(vendors).values({ tenantId, name: c.name, openingBalance: "0" }).returning({ id: vendors.id, name: vendors.name });
    created.push(s);
    resolved[c.key] = { action: "existing", vendorId: s.id, remember: false };
  }

  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, input.settings, resolved, v.categories, new Set(input.skipRows), input.overrides);
  const { importable, skipped } = plan(rows, input.includeDuplicates);
  const [imp] = await db.insert(expenseImports).values({ tenantId, fileName: input.fileName.slice(0, 200), rowCount: rows.length, suppliersCreated: created, createdBy: userId }).returning({ id: expenseImports.id });

  for (const [key, d] of Object.entries(input.supplierDecisions)) {
    if (d.action !== "existing" || !d.remember || !v.ownIds.has(d.vendorId)) continue;
    await db.insert(supplierAliases).values({ tenantId, alias: key, vendorId: d.vendorId }).onConflictDoUpdate({ target: [supplierAliases.tenantId, supplierAliases.alias], set: { vendorId: d.vendorId } });
  }
  await db
    .insert(importColumnMappings)
    .values({ tenantId, kind: KIND, signature, mapping: input.mapping as Record<string, string> })
    .onConflictDoUpdate({ target: [importColumnMappings.tenantId, importColumnMappings.kind, importColumnMappings.signature], set: { mapping: input.mapping as Record<string, string>, updatedAt: new Date() } });

  return { ok: true, importId: imp.id, supplierDecisions: resolved, rowNumbers: importable.map((r) => r.rowNumber), skipped, suppliersCreated: created.map((c) => c.name) };
}

/** Posts one slice of the prepared rows. The file is read and every row checked again; duplicates were settled in the first step. */
export async function importExpenseChunk(ctx: { tenantId: string; userId: string }, input: ExpenseRunInput & { importId: string; rowNumbers: number[] }): Promise<ChunkResult> {
  const { tenantId, userId } = ctx;
  const [imp] = await db.select({ id: expenseImports.id, status: expenseImports.status }).from(expenseImports).where(and(eq(expenseImports.id, input.importId), eq(expenseImports.tenantId, tenantId))).limit(1);
  if (!imp || imp.status !== "importing") return { ok: false, error: "This import is no longer open." };

  const parsed = readFile(input.base64, input.fileName);
  const v = await validDecisions(tenantId, input);
  const settings = { ...input.settings, defaultCategoryId: v.defaultCategoryOk ? input.settings.defaultCategoryId : null };
  const wanted = new Set(input.rowNumbers);
  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, settings, v.suppliers, v.categories, new Set(input.skipRows), input.overrides, { skipDuplicateCheck: true });
  const mine = rows.filter((r) => wanted.has(r.rowNumber));

  const taken = new Set((await db.select({ n: expenses.expenseNumber }).from(expenses).where(eq(expenses.tenantId, tenantId))).map((r) => r.n));
  let imported = 0;
  let total = 0;
  for (const r of mine) {
    try {
      if (r.status !== "ready" && r.status !== "duplicate") throw new Error(r.messages[0] ?? "This row needs attention.");
      if (!r.dateIso || !r.categoryId || r.taxable <= 0) throw new Error("This row needs attention.");
      await createExpenseCore(
        { tenantId, userId },
        {
          expenseDate: r.dateIso,
          categoryAccountId: r.categoryId,
          vendorId: r.vendorId,
          description: r.description,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: "",
          dueDate: r.dueDate,
          billType: r.billType ?? input.settings.defaultBillType,
          taxTreatment: "taxable",
          taxableAmount: r.taxable,
          vatAmount: r.vat,
          tdsAmount: r.tds,
          otherTaxAmount: 0,
          payments: r.paid > 0 && r.accountId ? [{ accountId: r.accountId, amount: r.paid, modeId: r.modeId }] : [],
        },
        { importId: input.importId, takenNumbers: taken }
      );
      imported++;
      total = round2(total + (r.total ?? 0));
    } catch (e) {
      return { ok: true, imported, total, stopped: { rowNumber: r.rowNumber, message: e instanceof Error ? e.message : "A row could not be saved" } };
    }
  }
  return { ok: true, imported, total, stopped: null };
}

export async function finishExpenseImport(ctx: { tenantId: string; userId: string }, input: { importId: string; stopped: boolean }): Promise<FinishedImport | null> {
  const { tenantId, userId } = ctx;
  const [imp] = await db.select().from(expenseImports).where(and(eq(expenseImports.id, input.importId), eq(expenseImports.tenantId, tenantId))).limit(1);
  if (!imp) return null;
  const [sum] = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${expenses.total}), 0)` })
    .from(expenses)
    .where(and(eq(expenses.importId, input.importId), ne(expenses.status, "void")));
  await db
    .update(expenseImports)
    .set({ expenseCount: sum.n, total: Number(sum.total).toFixed(2), skippedCount: Math.max(imp.rowCount - sum.n, 0), status: input.stopped ? "stopped" : "completed" })
    .where(eq(expenseImports.id, imp.id));
  await logAuditEvent({ tenantId, userId, action: "expense_import", entityType: "expense_import", entityId: imp.id, after: { fileName: imp.fileName, imported: sum.n, total: Number(sum.total), suppliersCreated: imp.suppliersCreated.map((s) => s.name), stopped: input.stopped } });
  return { imported: sum.n, total: Number(sum.total) };
}

// ------------------------------------------------------------------ history, undo, template

export async function listExpenseImports(tenantId: string, limit = 15) {
  const rows = await db
    .select({
      id: expenseImports.id,
      fileName: expenseImports.fileName,
      invoiceCount: expenseImports.expenseCount,
      total: expenseImports.total,
      status: expenseImports.status,
      createdAt: expenseImports.createdAt,
      active: sql<number>`(select count(*)::int from expenses e where e.import_id = "expense_imports"."id" and e.status <> 'void')`,
    })
    .from(expenseImports)
    .where(eq(expenseImports.tenantId, tenantId))
    .orderBy(desc(expenseImports.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, total: Number(r.total), createdAt: r.createdAt.toISOString() }));
}

export async function importExpenseIds(tenantId: string, importId: string) {
  const [imp] = await db.select({ id: expenseImports.id }).from(expenseImports).where(and(eq(expenseImports.id, importId), eq(expenseImports.tenantId, tenantId))).limit(1);
  if (!imp) return null;
  return db.select({ id: expenses.id, number: expenses.expenseNumber }).from(expenses).where(and(eq(expenses.importId, importId), ne(expenses.status, "void")));
}

export async function markExpenseImportUndone(tenantId: string, importId: string) {
  const remaining = await importExpenseIds(tenantId, importId);
  await db.update(expenseImports).set({ status: remaining && remaining.length === 0 ? "undone" : "partly_undone" }).where(and(eq(expenseImports.id, importId), eq(expenseImports.tenantId, tenantId)));
}

export async function buildExpenseTemplate(tenantId: string): Promise<string> {
  const [supplierList, categoryList, accountList] = await Promise.all([
    db.select({ name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)).orderBy(vendors.name),
    getExpenseCategoryAccounts(tenantId),
    cashBankAccountList(tenantId),
  ]);
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Category", "Supplier", "Description", "Invoice number", "Amount", "Bill type", "VAT amount", "TDS amount", "Due date", "Paid amount", "Paid from"],
    ["2083-04-15", categoryList[0]?.name ?? "Category", supplierList[0]?.name ?? "Supplier name", "Office rent", "R-101", 20000, "PAN", 0, 1000, "2083-04-30", 0, ""],
    ["2083-04-16", categoryList[0]?.name ?? "Category", "", "Taxi fare", "", 450, "No bill", 0, 0, "", 450, accountList[0]?.name ?? "Cash"],
  ]);
  sheet["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 26 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Expenses");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Suppliers (copy names from here)"], ...supplierList.map((s) => [s.name])]), "Suppliers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Expense categories"], ...categoryList.map((c) => [c.name])]), "Categories");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cash and bank accounts"], ...accountList.map((a) => [a.name])]), "Accounts");
  const payModes = (await buildPaymentResolver(tenantId)).modes;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Payment mode", "Accounts it can use (write the mode only if it has one account)"], ...payModes.map((m) => [m.name, m.accounts.map((a) => a.name).join(", ")])]), "Payment modes");
  const guideData = XLSX.utils.aoa_to_sheet(guideSheet(expenseColumnGuide()));
  guideData["!cols"] = [{ wch: 18 }, { wch: 11 }, { wch: 70 }, { wch: 16 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, guideData, "Columns");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["How to fill in the Expenses sheet"],
      ["One row is one expense. Only Date and Amount are needed."],
      ["Date: AD or BS (2083-04-15 or 2026-07-31)."],
      ["Category: one of your expense categories (see the Categories sheet), or choose a default in the import."],
      ["Supplier: leave blank for an expense paid in full to no one in particular."],
      ["Bill type: VAT, PAN, Estimate, Challan or No bill. VAT is worked out for VAT bills unless you give a VAT amount."],
      ["TDS amount: tax withheld from the payee; it is taken out of what you owe them."],
      ["Paid amount and Paid from: only if money was paid."],
    ]),
    "How to fill in"
  );
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}
