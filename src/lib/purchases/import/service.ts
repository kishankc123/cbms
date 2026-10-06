import * as XLSX from "xlsx";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { importColumnMappings, purchaseBills, purchaseImports, supplierAliases, vendors } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { resolveImportDates } from "@/lib/banking/import-dates";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { getCogsSubGroups } from "@/lib/ledger/control-accounts";
import { createCashPurchaseCore } from "@/lib/purchases/cash-purchase";
import { headerSignature } from "@/lib/sales/import/fields";
import { bestNameMatch, normalizeName, parseAmountCell } from "@/lib/sales/import/values";
import { checkPurchaseRow, type CategoryState, type SupplierState } from "./checks";
import { PURCHASE_FIELDS, purchaseMappingComplete, suggestPurchaseMapping, type PurchaseColumnMapping } from "./fields";
import type {
  CategoryDecision,
  CategoryGroup,
  ChunkResult,
  FinishedImport,
  PreparedImport,
  PurchaseCheckResult,
  PurchaseDateOptions,
  PurchaseFileAnalysis,
  PurchaseImportSettings,
  PurchaseOverrides,
  PurchaseReviewResult,
  PurchaseReviewRow,
  PurchaseRunInput,
  SupplierDecision,
  SupplierGroup,
} from "./types";
import { parsePurchaseBillType } from "./values";

// Import Purchases: reading a spreadsheet of consumable purchases (one row per bill), matching it to suppliers, categories
// and accounts, checking every row, and posting the clean ones through the same writer the Add New form uses. Plain server
// helpers (not server actions): the actions in purchases/import check the permission before calling any of this. The posting
// is split into steps (prepare, chunks, finish) so a long file never has to fit inside one request.

const MAX_ROWS = 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const KIND = "purchases";

type Parsed = { headers: string[]; rows: string[][] };

function readFile(base64: string, fileName: string): Parsed {
  const parsed = parseStatementFile(base64, fileName);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) throw new Error("The file has no rows to import.");
  if (parsed.rows.length > MAX_ROWS) throw new Error(`The file has ${parsed.rows.length} rows. Import up to ${MAX_ROWS} at a time.`);
  return parsed;
}

const colIndex = (headers: string[], name: string | undefined) => (name ? headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase()) : -1);

function datesFor(parsed: Parsed, mapping: PurchaseColumnMapping, opts: PurchaseDateOptions) {
  const idx = colIndex(parsed.headers, mapping.date);
  return resolveImportDates(parsed.rows.map((r) => (idx >= 0 ? r[idx] : undefined)), { header: mapping.date, choice: opts.choice, dayFirst: opts.dayFirst, allowMixed: opts.allowMixed });
}

const datesSummary = (d: ReturnType<typeof resolveImportDates>): PurchaseFileAnalysis["dates"] => ({ detected: d.detected, confidence: d.confidence, mixed: d.mixed, blocking: d.blocking, problemCount: d.problemCount, dayMonthAmbiguity: d.hasDayMonthAmbiguity });

// ------------------------------------------------------------------ step 1: what is in the file

export async function analyzePurchaseFile(tenantId: string, input: { fileName: string; base64: string }): Promise<PurchaseFileAnalysis> {
  const parsed = readFile(input.base64, input.fileName);
  const signature = headerSignature(parsed.headers);
  const [remembered] = await db.select().from(importColumnMappings).where(and(eq(importColumnMappings.tenantId, tenantId), eq(importColumnMappings.kind, KIND), eq(importColumnMappings.signature, signature))).limit(1);
  const known = remembered?.mapping as PurchaseColumnMapping | undefined;
  const usable = known && Object.values(known).every((h) => colIndex(parsed.headers, h) >= 0);
  const mapping = usable ? known! : suggestPurchaseMapping(parsed.headers);
  const dates = datesFor(parsed, mapping, { choice: "auto", dayFirst: true, allowMixed: false });
  return { headers: parsed.headers, sample: parsed.rows.slice(0, 5), rowCount: parsed.rows.length, mapping, remembered: Boolean(usable), mappingComplete: purchaseMappingComplete(mapping), dates: datesSummary(dates) };
}

// ------------------------------------------------------------------ step 2: every row, checked

type Row = PurchaseReviewRow & { vendorId: string | null; newSupplierName: string | null; categoryId: string | null; gross: number; discount: number; accountId: string | null; billNumber: string; description: string };
type Category = { id: string; code: string; name: string };

async function cashBankAccountList(tenantId: string) {
  const groups = await getCashBankAccounts(tenantId);
  return groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }]));
}

/** Puts the corrections typed in the review over the file's cells; a field the file has no column for gets one of its own. */
function applyOverrides(parsed: Parsed, mapping: PurchaseColumnMapping, overrides: PurchaseOverrides): { parsed: Parsed; mapping: PurchaseColumnMapping } {
  const valid = new Set<string>(PURCHASE_FIELDS.map((f) => f.key));
  const keys = new Set<string>();
  for (const o of Object.values(overrides)) for (const k of Object.keys(o)) if (valid.has(k)) keys.add(k);
  if (keys.size === 0) return { parsed, mapping };

  const headers = [...parsed.headers];
  const m: PurchaseColumnMapping = { ...mapping };
  for (const k of keys as Set<keyof PurchaseColumnMapping>) {
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
    for (const [k, v] of Object.entries(o)) if (valid.has(k)) copy[colIndex(headers, m[k as keyof PurchaseColumnMapping])] = String(v ?? "").slice(0, 200);
    return copy;
  });
  return { parsed: { headers, rows }, mapping: m };
}

async function buildRows(
  tenantId: string,
  parsedIn: Parsed,
  mappingIn: PurchaseColumnMapping,
  dateOptions: PurchaseDateOptions,
  settings: PurchaseImportSettings,
  supplierDecisions: Record<string, SupplierDecision>,
  categoryDecisions: Record<string, CategoryDecision>,
  skipRows: Set<number>,
  overrides: PurchaseOverrides = {},
  opts: { skipDuplicateCheck?: boolean } = {}
) {
  const { parsed, mapping } = applyOverrides(parsedIn, mappingIn, overrides);
  for (const f of PURCHASE_FIELDS.filter((x) => x.required)) if (colIndex(parsed.headers, mapping[f.key]) < 0) throw new Error(`Choose the column that holds the ${f.label.toLowerCase()}.`);
  const idx = Object.fromEntries(PURCHASE_FIELDS.map((f) => [f.key, colIndex(parsed.headers, mapping[f.key])])) as Record<(typeof PURCHASE_FIELDS)[number]["key"], number>;
  const cell = (r: string[], k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");

  const dates = datesFor(parsed, mapping, dateOptions);
  const [supplierList, aliasRows, accountList, categoryList] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)),
    db.select({ alias: supplierAliases.alias, vendorId: supplierAliases.vendorId }).from(supplierAliases).where(eq(supplierAliases.tenantId, tenantId)),
    cashBankAccountList(tenantId),
    getCogsSubGroups(tenantId),
  ]);
  const byName = new Map<string, { id: string; name: string }>();
  for (const s of supplierList) if (!byName.has(normalizeName(s.name))) byName.set(normalizeName(s.name), s);
  const byAlias = new Map(aliasRows.map((a) => [a.alias, a.vendorId]));
  const supplierById = new Map(supplierList.map((s) => [s.id, s]));
  const accountByText = new Map<string, string>();
  for (const a of accountList) {
    accountByText.set(normalizeName(a.name), a.id);
    accountByText.set(normalizeName(a.code), a.id);
  }
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

  // Bills already in the books for the file's date range (and every numbered bill, since a number is unique per supplier).
  const existingByNumber = new Set<string>();
  const existingByAmount = new Set<string>();
  if (!opts.skipDuplicateCheck && isoDates.length > 0) {
    const from = isoDates.reduce((a, b) => (a < b ? a : b));
    const to = isoDates.reduce((a, b) => (a > b ? a : b));
    const rows = await db
      .select({ vendorId: purchaseBills.vendorId, number: purchaseBills.billNumber, date: purchaseBills.billDate, total: purchaseBills.total })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.tenantId, tenantId), ne(purchaseBills.status, "void")));
    for (const r of rows) {
      existingByNumber.add(`${r.vendorId ?? ""}|${r.number.toLowerCase()}`);
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
    const accountId = accountText ? accountByText.get(normalizeName(accountText)) ?? null : null;
    const amount = parseAmountCell(cell(r, "amount"));
    const discount = parseAmountCell(cell(r, "discount"));
    const paid = parseAmountCell(cell(r, "paid"));
    const billTypeText = cell(r, "billType");
    const iso = d?.iso ?? null;
    const billNumber = cell(r, "billNumber");

    const check = checkPurchaseRow({
      dateIso: iso,
      dateNote: d?.note ?? (cell(r, "date") ? "The date can't be read." : "There is no date."),
      periodLocked: iso ? lockedByDate.get(iso) ?? false : false,
      amount,
      discount,
      billType: parsePurchaseBillType(billTypeText),
      billTypeText,
      paid,
      account: accountText === "" ? "none" : accountId ? "ok" : "unknown",
      accountText,
      supplier,
      category,
      categoryText,
      duplicate: false,
      settings: { amountsIncludeVat: settings.amountsIncludeVat, vatRate: iso ? vatByDate.get(iso) ?? 0 : 0, defaultBillType: settings.defaultBillType, paidMode: settings.paidMode, hasDefaultAccount: Boolean(settings.defaultAccountId) },
    });

    let status = check.status;
    let messages = check.messages;
    if (status === "ready" && !opts.skipDuplicateCheck) {
      const owner = vendorId ?? "";
      const numberKey = `${owner}|${billNumber.toLowerCase()}`;
      const amountKey = iso && check.computed ? `${iso}|${owner}|${check.computed.total.toFixed(2)}` : null;
      if (billNumber && existingByNumber.has(numberKey)) {
        status = "duplicate";
        messages = ["A bill with this number already exists for this supplier."];
      } else if (!billNumber && amountKey && existingByAmount.has(amountKey)) {
        status = "duplicate";
        messages = ["A bill with the same date, supplier and amount already exists."];
      } else if (billNumber && seenInFile.has(numberKey)) {
        status = "duplicate";
        messages = ["This bill number appears earlier in the file for the same supplier."];
      }
      if (billNumber) seenInFile.add(numberKey);
    }

    const supplierDecision = supplierKey ? supplierDecisions[supplierKey] : undefined;
    out.push({
      rowNumber,
      raw: Object.fromEntries(PURCHASE_FIELDS.filter((f) => idx[f.key] >= 0).map((f) => [f.key, cell(r, f.key)])),
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
      tax: check.computed?.tax ?? null,
      vendorId,
      newSupplierName: supplier === "create" && supplierDecision?.action === "create" ? supplierDecision.name : null,
      categoryId,
      gross: check.computed?.gross ?? 0,
      discount: check.computed?.discount ?? 0,
      accountId: accountId ?? settings.defaultAccountId,
      billNumber,
      description: cell(r, "description"),
    });
  });
  return { rows: out, dates, supplierList, categoryList };
}

export async function reviewPurchaseFile(
  tenantId: string,
  input: { base64: string; fileName: string; mapping: PurchaseColumnMapping; dateOptions: PurchaseDateOptions; settings: PurchaseImportSettings; overrides?: PurchaseOverrides }
): Promise<PurchaseReviewResult> {
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
    // A row waiting only on a supplier or category decision will import once that is made, so it counts toward what is to come.
    const pending = r.status === "attention" && r.issues.length > 0 && r.issues.every((i) => (i === "supplier" && r.supplierKey !== null) || (i === "category" && r.categoryKey !== null));
    if (r.status === "ready" || pending) {
      importTotal = round2(importTotal + (r.total ?? 0));
      importTax = round2(importTax + (r.tax ?? 0));
    }
  }
  const strip = (r: Row): PurchaseReviewRow => ({
    rowNumber: r.rowNumber, raw: r.raw, dateIso: r.dateIso, dateRaw: r.dateRaw, supplierText: r.supplierText, supplierName: r.supplierName, supplierKey: r.supplierKey,
    categoryText: r.categoryText, categoryName: r.categoryName, categoryKey: r.categoryKey, amount: r.amount, paid: r.paid, billType: r.billType, status: r.status,
    issues: r.issues, messages: r.messages, total: r.total, tax: r.tax,
  });
  return { rows: rows.map(strip), supplierGroups: [...sGroups.values()].sort((a, b) => b.rows - a.rows), categoryGroups: [...cGroups.values()].sort((a, b) => b.rows - a.rows), counts, fileTotal, importTotal, importTax, dates: datesSummary(dates) };
}

// ------------------------------------------------------------------ step 3: import, in steps

function plan(rows: Row[], includeDuplicates: boolean) {
  const importable = rows.filter((r) => (r.status === "ready" || (r.status === "duplicate" && includeDuplicates)) && r.dateIso && r.gross > 0 && r.categoryId);
  const skipped = rows.filter((r) => !importable.includes(r)).map((r) => ({ rowNumber: r.rowNumber, reason: r.status === "skipped" ? "Skipped" : r.messages[0] ?? "Needs attention" }));
  return { importable, skipped };
}

/** Which of the decisions the browser sent are valid for this organization; ticked new suppliers are returned by name. */
async function validDecisions(tenantId: string, input: PurchaseRunInput) {
  const own = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const ownIds = new Set(own.map((s) => s.id));
  const byNormName = new Map(own.map((s) => [normalizeName(s.name), s]));
  const categoryIds = new Set((await getCogsSubGroups(tenantId)).map((c) => c.id));

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
export async function checkPurchaseImport(tenantId: string, input: PurchaseRunInput): Promise<PurchaseCheckResult> {
  const parsed = readFile(input.base64, input.fileName);
  const v = await validDecisions(tenantId, input);
  const settings = { ...input.settings, defaultCategoryId: v.defaultCategoryOk ? input.settings.defaultCategoryId : null };
  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, settings, v.suppliers, v.categories, new Set(input.skipRows), input.overrides);
  const { importable, skipped } = plan(rows, input.includeDuplicates);
  return { wouldImport: importable.length, total: round2(importable.reduce((s, r) => s + (r.total ?? 0), 0)), tax: round2(importable.reduce((s, r) => s + (r.tax ?? 0), 0)), suppliersToCreate: v.toCreate.map((c) => c.name), skipped };
}

/** Sets an import up: creates the ticked suppliers and the import record, remembers what was learned, and lists the rows to post. */
export async function preparePurchaseImport(ctx: { tenantId: string; userId: string }, input: PurchaseRunInput): Promise<PreparedImport> {
  const { tenantId, userId } = ctx;
  const parsed = readFile(input.base64, input.fileName);
  const signature = headerSignature(parsed.headers);

  if (input.settings.defaultAccountId && !(await cashBankAccountList(tenantId)).some((a) => a.id === input.settings.defaultAccountId)) return { ok: false, error: "Choose a cash or bank account of this organization." };
  const v = await validDecisions(tenantId, input);
  if (!v.defaultCategoryOk) return { ok: false, error: "Choose a purchase category of this organization." };

  // Rows are checked before anything is created, so an import with nothing to post creates nothing.
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
  const [imp] = await db.insert(purchaseImports).values({ tenantId, fileName: input.fileName.slice(0, 200), rowCount: rows.length, suppliersCreated: created, createdBy: userId }).returning({ id: purchaseImports.id });

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
export async function importPurchaseChunk(ctx: { tenantId: string; userId: string }, input: PurchaseRunInput & { importId: string; rowNumbers: number[] }): Promise<ChunkResult> {
  const { tenantId, userId } = ctx;
  const [imp] = await db.select({ id: purchaseImports.id, status: purchaseImports.status }).from(purchaseImports).where(and(eq(purchaseImports.id, input.importId), eq(purchaseImports.tenantId, tenantId))).limit(1);
  if (!imp || imp.status !== "importing") return { ok: false, error: "This import is no longer open." };

  const parsed = readFile(input.base64, input.fileName);
  const v = await validDecisions(tenantId, input);
  const settings = { ...input.settings, defaultCategoryId: v.defaultCategoryOk ? input.settings.defaultCategoryId : null };
  const wanted = new Set(input.rowNumbers);
  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, settings, v.suppliers, v.categories, new Set(input.skipRows), input.overrides, { skipDuplicateCheck: true });
  const mine = rows.filter((r) => wanted.has(r.rowNumber));

  // Numbers already in use, read once for the whole slice.
  const taken = new Set((await db.select({ n: purchaseBills.billNumber }).from(purchaseBills).where(eq(purchaseBills.tenantId, tenantId))).map((r) => r.n));
  let imported = 0;
  let total = 0;
  for (const r of mine) {
    try {
      if (r.status !== "ready" && r.status !== "duplicate") throw new Error(r.messages[0] ?? "This row needs attention.");
      if (!r.dateIso || !r.categoryId || r.gross <= 0) throw new Error("This row needs attention.");
      await createCashPurchaseCore(
        { tenantId, userId },
        {
          billNumber: r.billNumber,
          billDate: r.dateIso,
          vendorId: r.vendorId ?? "",
          billType: r.billType ?? input.settings.defaultBillType,
          lines: [{ description: r.description, categoryId: r.categoryId, rate: r.gross, quantity: 1, discount: r.discount }],
          payments: r.paid > 0 && r.accountId ? [{ accountId: r.accountId, amount: r.paid }] : [],
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

/** Closes an import: its real totals come from what was posted, and the whole thing is recorded in the audit log. */
export async function finishPurchaseImport(ctx: { tenantId: string; userId: string }, input: { importId: string; stopped: boolean }): Promise<FinishedImport | null> {
  const { tenantId, userId } = ctx;
  const [imp] = await db.select().from(purchaseImports).where(and(eq(purchaseImports.id, input.importId), eq(purchaseImports.tenantId, tenantId))).limit(1);
  if (!imp) return null;
  const [sum] = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${purchaseBills.total}), 0)` })
    .from(purchaseBills)
    .where(and(eq(purchaseBills.importId, input.importId), ne(purchaseBills.status, "void")));
  await db
    .update(purchaseImports)
    .set({ billCount: sum.n, total: Number(sum.total).toFixed(2), skippedCount: Math.max(imp.rowCount - sum.n, 0), status: input.stopped ? "stopped" : "completed" })
    .where(eq(purchaseImports.id, imp.id));
  await logAuditEvent({ tenantId, userId, action: "purchase_import", entityType: "purchase_import", entityId: imp.id, after: { fileName: imp.fileName, imported: sum.n, total: Number(sum.total), suppliersCreated: imp.suppliersCreated.map((s) => s.name), stopped: input.stopped } });
  return { imported: sum.n, total: Number(sum.total) };
}

// ------------------------------------------------------------------ history, undo, template

export async function listPurchaseImports(tenantId: string, limit = 15) {
  const rows = await db
    .select({
      id: purchaseImports.id,
      fileName: purchaseImports.fileName,
      invoiceCount: purchaseImports.billCount,
      total: purchaseImports.total,
      status: purchaseImports.status,
      createdAt: purchaseImports.createdAt,
      active: sql<number>`(select count(*)::int from purchase_bills b where b.import_id = "purchase_imports"."id" and b.status <> 'void')`,
    })
    .from(purchaseImports)
    .where(eq(purchaseImports.tenantId, tenantId))
    .orderBy(desc(purchaseImports.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, total: Number(r.total), createdAt: r.createdAt.toISOString() }));
}

export async function importBillIds(tenantId: string, importId: string) {
  const [imp] = await db.select({ id: purchaseImports.id }).from(purchaseImports).where(and(eq(purchaseImports.id, importId), eq(purchaseImports.tenantId, tenantId))).limit(1);
  if (!imp) return null;
  return db.select({ id: purchaseBills.id, number: purchaseBills.billNumber }).from(purchaseBills).where(and(eq(purchaseBills.importId, importId), ne(purchaseBills.status, "void")));
}

export async function markPurchaseImportUndone(tenantId: string, importId: string) {
  const remaining = await importBillIds(tenantId, importId);
  await db.update(purchaseImports).set({ status: remaining && remaining.length === 0 ? "undone" : "partly_undone" }).where(and(eq(purchaseImports.id, importId), eq(purchaseImports.tenantId, tenantId)));
}

export async function buildPurchaseTemplate(tenantId: string): Promise<string> {
  const [supplierList, categoryList, accountList] = await Promise.all([
    db.select({ name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)).orderBy(vendors.name),
    getCogsSubGroups(tenantId),
    cashBankAccountList(tenantId),
  ]);
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Supplier", "Category", "Bill number", "Description", "Amount", "Discount", "Bill type", "Paid amount", "Paid from"],
    ["2083-04-15", supplierList[0]?.name ?? "Supplier name", categoryList[0]?.name ?? "Category", "B-101", "Office supplies", 5000, 0, "VAT", 0, ""],
    ["2083-04-16", "", categoryList[0]?.name ?? "Category", "", "Tea and snacks", 850, 0, "No bill", 850, accountList[0]?.name ?? "Cash"],
  ]);
  sheet["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 24 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Purchases");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Suppliers (copy names from here)"], ...supplierList.map((s) => [s.name])]), "Suppliers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Purchase categories"], ...categoryList.map((c) => [c.name])]), "Categories");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cash and bank accounts"], ...accountList.map((a) => [a.name])]), "Accounts");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["How to fill in the Purchases sheet"],
      ["One row is one bill. Only Date and Amount are needed."],
      ["Date: AD or BS (2083-04-15 or 2026-07-31)."],
      ["Category: one of your purchase categories (see the Categories sheet), or choose a default in the import."],
      ["Supplier: leave blank for a purchase paid in full to no one in particular."],
      ["Bill type: VAT, PAN, Estimate, Challan or No bill. Only a VAT bill carries VAT."],
      ["Paid amount and Paid from: only if money was paid."],
      ["Bill number: the supplier's own number. Blank gets an automatic one."],
    ]),
    "How to fill in"
  );
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

