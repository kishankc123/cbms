import * as XLSX from "xlsx";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerAliases, customers, importColumnMappings, salesImports, salesInvoices } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { resolveImportDates } from "@/lib/banking/import-dates";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { PartialBatchError, postSalesBatch, type BatchInvoiceRow } from "@/lib/sales/invoice-records";
import { salesVatRate } from "@/lib/sales/vat";
import { checkRow, type CustomerState } from "./checks";
import { headerSignature, IMPORT_FIELDS, mappingComplete, suggestMapping, type SalesColumnMapping } from "./fields";
import type { CheckResult, CustomerGroup, DateOptions, FileAnalysis, GroupDecision, ImportSettings, Overrides, ReviewResult, ReviewRow, RunInput, RunResult } from "./types";
import { bestNameMatch, normalizeName, parseAmountCell, parseBillTypeCell } from "./values";

// Import Sales: reading a spreadsheet of sales (one row per invoice), matching it to customers and accounts, checking every
// row, and posting the clean ones through the same writer the Multi-Invoice form uses. Plain server helpers (not server
// actions): the actions in sales/import check the permission before calling any of this.

const MAX_ROWS = 5000;
const CHUNK = 50;
const round2 = (n: number) => Math.round(n * 100) / 100;
const KIND = "sales";

type Parsed = { headers: string[]; rows: string[][] };

function readFile(base64: string, fileName: string): Parsed {
  const parsed = parseStatementFile(base64, fileName);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) throw new Error("The file has no rows to import.");
  if (parsed.rows.length > MAX_ROWS) throw new Error(`The file has ${parsed.rows.length} rows. Import up to ${MAX_ROWS} at a time.`);
  return parsed;
}

const colIndex = (headers: string[], name: string | undefined) => (name ? headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase()) : -1);

function datesFor(parsed: Parsed, mapping: SalesColumnMapping, opts: DateOptions) {
  const idx = colIndex(parsed.headers, mapping.date);
  return resolveImportDates(parsed.rows.map((r) => (idx >= 0 ? r[idx] : undefined)), { header: mapping.date, choice: opts.choice, dayFirst: opts.dayFirst, allowMixed: opts.allowMixed });
}

const datesSummary = (d: ReturnType<typeof resolveImportDates>): FileAnalysis["dates"] => ({ detected: d.detected, confidence: d.confidence, mixed: d.mixed, blocking: d.blocking, problemCount: d.problemCount, dayMonthAmbiguity: d.hasDayMonthAmbiguity });

// ------------------------------------------------------------------ step 1: what is in the file

export async function analyzeSalesFile(tenantId: string, input: { fileName: string; base64: string }): Promise<FileAnalysis> {
  const parsed = readFile(input.base64, input.fileName);
  const signature = headerSignature(parsed.headers);
  const [remembered] = await db.select().from(importColumnMappings).where(and(eq(importColumnMappings.tenantId, tenantId), eq(importColumnMappings.kind, KIND), eq(importColumnMappings.signature, signature))).limit(1);

  // A remembered mapping is used only while every header it names is still in the file.
  const known = remembered?.mapping as SalesColumnMapping | undefined;
  const usable = known && Object.values(known).every((h) => colIndex(parsed.headers, h) >= 0);
  const mapping = usable ? known! : suggestMapping(parsed.headers);

  const dates = datesFor(parsed, mapping, { choice: "auto", dayFirst: true, allowMixed: false });
  return { headers: parsed.headers, sample: parsed.rows.slice(0, 5), rowCount: parsed.rows.length, mapping, remembered: Boolean(usable), mappingComplete: mappingComplete(mapping), dates: datesSummary(dates) };
}

// ------------------------------------------------------------------ step 2: every row, checked

type Row = ReviewRow & { customerId: string | null; newCustomerName: string | null; gross: number; discount: number; accountId: string | null };

async function cashBankAccountList(tenantId: string) {
  const groups = await getCashBankAccounts(tenantId);
  return groups.flatMap((g) => (g.children.length > 0 ? g.children : [{ id: g.id, code: g.code, name: g.name }]));
}

/**
 * Puts the corrections typed in the review over the file's own cells. A field the file has no column for gets one of its own
 * (so a customer can be typed in for a row even when the file never had a customer column).
 */
function applyOverrides(parsed: Parsed, mapping: SalesColumnMapping, overrides: Overrides): { parsed: Parsed; mapping: SalesColumnMapping } {
  const valid = new Set(IMPORT_FIELDS.map((f) => f.key));
  const keys = new Set<string>();
  for (const o of Object.values(overrides)) for (const k of Object.keys(o)) if (valid.has(k as never)) keys.add(k);
  if (keys.size === 0) return { parsed, mapping };

  const headers = [...parsed.headers];
  const m: SalesColumnMapping = { ...mapping };
  for (const k of keys as Set<keyof SalesColumnMapping>) {
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
    for (const [k, v] of Object.entries(o)) if (valid.has(k as never)) copy[colIndex(headers, m[k as keyof SalesColumnMapping])] = String(v ?? "").slice(0, 200);
    return copy;
  });
  return { parsed: { headers, rows }, mapping: m };
}

/** Everything the review and the import both need, worked out once from the file, the settings and the decisions made so far. */
async function buildRows(tenantId: string, parsedIn: Parsed, mappingIn: SalesColumnMapping, dateOptions: DateOptions, settings: ImportSettings, decisions: Record<string, GroupDecision>, skipRows: Set<number>, overrides: Overrides = {}) {
  const { parsed, mapping } = applyOverrides(parsedIn, mappingIn, overrides);
  for (const f of IMPORT_FIELDS.filter((x) => x.required)) if (colIndex(parsed.headers, mapping[f.key]) < 0) throw new Error(`Choose the column that holds the ${f.label.toLowerCase()}.`);
  const idx = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, colIndex(parsed.headers, mapping[f.key])])) as Record<(typeof IMPORT_FIELDS)[number]["key"], number>;
  const cell = (r: string[], k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");

  const dates = datesFor(parsed, mapping, dateOptions);
  const [customerList, aliasRows, accountList] = await Promise.all([
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId)),
    db.select({ alias: customerAliases.alias, customerId: customerAliases.customerId }).from(customerAliases).where(eq(customerAliases.tenantId, tenantId)),
    cashBankAccountList(tenantId),
  ]);
  const byName = new Map<string, { id: string; name: string }>();
  for (const c of customerList) if (!byName.has(normalizeName(c.name))) byName.set(normalizeName(c.name), c);
  const byAlias = new Map(aliasRows.map((a) => [a.alias, a.customerId]));
  // A sale with no customer is posted to the "Cash Sale" customer, so that is who an existing invoice would be under.
  const cashSaleId = byName.get("cash sale")?.id ?? null;
  const customerById = new Map(customerList.map((c) => [c.id, c]));
  const accountByText = new Map<string, string>();
  for (const a of accountList) {
    accountByText.set(normalizeName(a.name), a.id);
    accountByText.set(normalizeName(a.code), a.id);
  }

  const lockedByDate = new Map<string, boolean>();
  const vatByDate = new Map<string, number>();
  const isoDates = [...new Set(dates.rows.map((r) => r.iso).filter((d): d is string => Boolean(d)))];
  for (const d of isoDates) {
    lockedByDate.set(d, await assertPeriodOpen(tenantId, d).then(() => false, () => true));
    vatByDate.set(d, await salesVatRate(tenantId, d));
  }

  // Invoices already in the books for the file's date range, to catch the same file being imported twice.
  const existing = new Set<string>();
  if (isoDates.length > 0) {
    const from = isoDates.reduce((a, b) => (a < b ? a : b));
    const to = isoDates.reduce((a, b) => (a > b ? a : b));
    const rows = await db
      .select({ customerId: salesInvoices.customerId, date: salesInvoices.invoiceDate, total: salesInvoices.total })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.tenantId, tenantId), ne(salesInvoices.status, "void"), gte(salesInvoices.invoiceDate, from), lte(salesInvoices.invoiceDate, to)));
    for (const r of rows) existing.add(`${r.date}|${r.customerId}|${Number(r.total).toFixed(2)}`);
  }

  const out: Row[] = [];
  parsed.rows.forEach((r, i) => {
    const rowNumber = i + 2;
    if (r.every((c) => (c ?? "").trim() === "")) return;
    const d = dates.rows[i];
    const customerText = cell(r, "customer");
    const key = customerText ? normalizeName(customerText) : null;

    // Who the customer is: set up already (by name or a remembered alias), decided in the review, or not yet known.
    let customerId: string | null = null;
    let state: CustomerState = "none";
    if (key) {
      const matched = byName.get(key)?.id ?? byAlias.get(key) ?? null;
      const decision = decisions[key];
      if (matched) {
        customerId = matched;
        state = "matched";
      } else if (decision?.action === "existing" && customerById.has(decision.customerId)) {
        customerId = decision.customerId;
        state = "matched";
      } else if (decision?.action === "create") {
        state = "create";
      } else if (decision?.action === "skip") {
        state = "skipped";
      } else {
        state = "unknown";
      }
    }
    if (skipRows.has(rowNumber)) state = "skipped";

    const accountText = cell(r, "account");
    const accountId = accountText ? accountByText.get(normalizeName(accountText)) ?? null : null;
    const amount = parseAmountCell(cell(r, "amount"));
    const discount = parseAmountCell(cell(r, "discount"));
    const paid = parseAmountCell(cell(r, "paid"));
    const billTypeText = cell(r, "billType");
    const billType = parseBillTypeCell(billTypeText);
    const iso = d?.iso ?? null;

    const check = checkRow({
      dateIso: iso,
      dateNote: d?.note ?? (cell(r, "date") ? "The date can't be read." : "There is no date."),
      periodLocked: iso ? lockedByDate.get(iso) ?? false : false,
      amount,
      discount,
      billType,
      billTypeText,
      paid,
      account: accountText === "" ? "none" : accountId ? "ok" : "unknown",
      accountText,
      customer: state,
      duplicate: false, // set below, once the total is known
      settings: { amountsIncludeVat: settings.amountsIncludeVat, vatRate: iso ? vatByDate.get(iso) ?? 0 : 0, defaultBillType: settings.defaultBillType, paidMode: settings.paidMode, hasDefaultAccount: Boolean(settings.defaultAccountId) },
    });

    let status = check.status;
    const owner = customerId ?? (state === "none" ? cashSaleId : null);
    if (status === "ready" && owner && check.computed && iso && existing.has(`${iso}|${owner}|${check.computed.total.toFixed(2)}`)) {
      status = "duplicate";
      check.messages = ["An invoice with the same date, customer and amount already exists."];
    }

    out.push({
      rowNumber,
      raw: Object.fromEntries(IMPORT_FIELDS.filter((f) => idx[f.key] >= 0).map((f) => [f.key, cell(r, f.key)])),
      dateRaw: cell(r, "date"),
      dateIso: iso,
      customerText,
      customerName: customerId ? customerById.get(customerId)?.name ?? null : state === "create" ? decisions[key!] && decisions[key!].action === "create" ? (decisions[key!] as { name: string }).name : customerText : null,
      customerKey: key,
      amount: amount.value,
      paid: check.computed?.paid ?? 0,
      billType: check.computed?.billType ?? null,
      status,
      issues: check.issues,
      messages: check.messages,
      total: check.computed?.total ?? null,
      tax: check.computed?.tax ?? null,
      customerId,
      newCustomerName: state === "create" ? (decisions[key!] as { name: string }).name : null,
      gross: check.computed?.gross ?? 0,
      discount: check.computed?.discount ?? 0,
      accountId: accountId ?? settings.defaultAccountId,
    });
  });
  return { rows: out, dates, customerList };
}

export async function reviewSalesFile(tenantId: string, input: { base64: string; fileName: string; mapping: SalesColumnMapping; dateOptions: DateOptions; settings: ImportSettings; overrides?: Overrides }): Promise<ReviewResult> {
  const parsed = readFile(input.base64, input.fileName);
  const { rows, dates, customerList } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, input.settings, {}, new Set(), input.overrides);

  // Names in the file that match nobody yet, grouped so each is decided once. The closest existing name is suggested.
  const groups = new Map<string, CustomerGroup>();
  for (const r of rows) {
    if (r.status === "skipped" || !r.customerKey || r.customerId) continue;
    const g = groups.get(r.customerKey) ?? { key: r.customerKey, text: r.customerText, rows: 0, total: 0, suggestion: null };
    g.rows++;
    g.total = round2(g.total + (r.total ?? r.amount ?? 0));
    groups.set(r.customerKey, g);
  }
  for (const g of groups.values()) {
    const best = bestNameMatch(g.text, customerList);
    if (best) g.suggestion = { customerId: best.match.id, name: best.match.name, score: Math.round(best.score * 100) / 100 };
  }

  const counts = { ready: 0, attention: 0, duplicate: 0, skipped: 0 };
  let importTotal = 0;
  let importTax = 0;
  let fileTotal = 0;
  for (const r of rows) {
    counts[r.status]++;
    fileTotal = round2(fileTotal + (r.amount ?? 0));
    // A row waiting only on its customer will import once that is decided, so it counts toward what is to come.
    const pendingCustomer = r.status === "attention" && r.issues.length === 1 && r.issues[0] === "customer" && r.customerKey !== null;
    if (r.status === "ready" || pendingCustomer) {
      importTotal = round2(importTotal + (r.total ?? 0));
      importTax = round2(importTax + (r.tax ?? 0));
    }
  }
  const strip = (r: Row): ReviewRow => ({ rowNumber: r.rowNumber, raw: r.raw, dateRaw: r.dateRaw, dateIso: r.dateIso, customerText: r.customerText, customerName: r.customerName, customerKey: r.customerKey, amount: r.amount, paid: r.paid, billType: r.billType, status: r.status, issues: r.issues, messages: r.messages, total: r.total, tax: r.tax });
  return { rows: rows.map(strip), groups: [...groups.values()].sort((a, b) => b.rows - a.rows), counts, fileTotal, importTotal, importTax, dates: datesSummary(dates), customersToCreate: groups.size };
}

// ------------------------------------------------------------------ step 3: import

/** Which rows would be posted, and why each of the others would not. The check and the import use the same answer. */
function plan(rows: Row[], includeDuplicates: boolean) {
  const importable = rows.filter((r) => (r.status === "ready" || (r.status === "duplicate" && includeDuplicates)) && r.dateIso && r.gross > 0);
  const skipped = rows.filter((r) => !importable.includes(r)).map((r) => ({ rowNumber: r.rowNumber, reason: r.status === "skipped" ? "Skipped" : r.messages[0] ?? "Needs attention" }));
  return { importable, skipped };
}

/**
 * Everything an import would do, without doing any of it: nothing is created or posted and nothing is remembered. Ticked
 * new customers count as existing for the checks, and are listed so the person knows who would be added.
 */
export async function checkSalesImport(tenantId: string, input: RunInput): Promise<CheckResult> {
  const parsed = readFile(input.base64, input.fileName);
  const own = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId));
  const ownIds = new Set(own.map((c) => c.id));
  const byNormName = new Map(own.map((c) => [normalizeName(c.name), c]));

  const decisions: Record<string, GroupDecision> = {};
  const toCreate = new Map<string, string>();
  for (const [key, d] of Object.entries(input.decisions)) {
    if (d.action === "existing") {
      if (ownIds.has(d.customerId)) decisions[key] = d;
    } else if (d.action === "skip") {
      decisions[key] = d;
    } else if (d.action === "create") {
      const name = d.name.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!name) continue;
      const same = byNormName.get(normalizeName(name));
      if (same) decisions[key] = { action: "existing", customerId: same.id, remember: false };
      else {
        decisions[key] = { action: "create", name };
        toCreate.set(normalizeName(name), name);
      }
    }
  }
  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, input.settings, decisions, new Set(input.skipRows), input.overrides);
  const { importable, skipped } = plan(rows, input.includeDuplicates);
  return {
    wouldImport: importable.length,
    total: round2(importable.reduce((s, r) => s + (r.total ?? 0), 0)),
    tax: round2(importable.reduce((s, r) => s + (r.tax ?? 0), 0)),
    customersToCreate: [...toCreate.values()],
    skipped,
  };
}

export async function runSalesImport(ctx: { tenantId: string; userId: string }, input: RunInput): Promise<RunResult> {
  const { tenantId, userId } = ctx;
  const parsed = readFile(input.base64, input.fileName);
  const signature = headerSignature(parsed.headers);

  if (input.settings.defaultAccountId) {
    const accountList = await cashBankAccountList(tenantId);
    if (!accountList.some((a) => a.id === input.settings.defaultAccountId)) return { ok: false, error: "Choose a cash or bank account of this organization." };
  }

  // Decisions: an existing customer must belong to this organization; ticked new customers are created (or, if one of that
  // name already exists, that one is used) before any invoice is posted.
  const resolved: Record<string, GroupDecision> = {};
  const created: { id: string; name: string }[] = [];
  const existingCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId));
  const byNormName = new Map(existingCustomers.map((c) => [normalizeName(c.name), c]));
  const ownIds = new Set(existingCustomers.map((c) => c.id));
  for (const [key, d] of Object.entries(input.decisions)) {
    if (d.action === "existing") {
      if (ownIds.has(d.customerId)) resolved[key] = d;
    } else if (d.action === "skip") {
      resolved[key] = d;
    } else if (d.action === "create") {
      const name = d.name.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!name) continue;
      const same = byNormName.get(normalizeName(name));
      if (same) {
        resolved[key] = { action: "existing", customerId: same.id, remember: false };
      } else {
        const [c] = await db.insert(customers).values({ tenantId, name, openingBalance: "0" }).returning({ id: customers.id, name: customers.name });
        created.push(c);
        byNormName.set(normalizeName(name), c);
        resolved[key] = { action: "existing", customerId: c.id, remember: false };
      }
    }
  }

  const { rows } = await buildRows(tenantId, parsed, input.mapping, input.dateOptions, input.settings, resolved, new Set(input.skipRows), input.overrides);
  const { importable, skipped } = plan(rows, input.includeDuplicates);
  if (importable.length === 0) return { ok: false, error: "There is nothing to import: every row needs attention or was skipped." };

  const [imp] = await db.insert(salesImports).values({ tenantId, fileName: input.fileName.slice(0, 200), rowCount: rows.length, customersCreated: created, createdBy: userId }).returning({ id: salesImports.id });

  let imported = 0;
  let total = 0;
  let stopped: { rowNumber: number; message: string } | null = null;
  for (let i = 0; i < importable.length; i += CHUNK) {
    const part = importable.slice(i, i + CHUNK);
    const batch: BatchInvoiceRow[] = part.map((r) => ({
      invoiceDate: r.dateIso!,
      customerId: r.customerId ?? "",
      grossAmount: r.gross,
      discountAmount: r.discount,
      billType: r.billType ?? input.settings.defaultBillType,
      payments: r.paid > 0 && r.accountId ? [{ accountId: r.accountId, amount: r.paid }] : [],
    }));
    try {
      const made = await postSalesBatch({ tenantId, userId }, batch, { importId: imp.id });
      imported += made.length;
      total = round2(total + part.reduce((s, r) => s + (r.total ?? 0), 0));
    } catch (e) {
      const partial = e instanceof PartialBatchError ? e : null;
      if (partial) {
        imported += partial.created.length;
        total = round2(total + partial.created.reduce((s, c) => s + (part[c.index]?.total ?? 0), 0));
      }
      stopped = { rowNumber: part[partial ? partial.failedIndex : 0].rowNumber, message: e instanceof Error ? e.message : "A row could not be saved" };
      break;
    }
  }

  await db
    .update(salesImports)
    .set({ invoiceCount: imported, skippedCount: rows.length - imported, total: total.toFixed(2), status: stopped ? "stopped" : "completed" })
    .where(eq(salesImports.id, imp.id));

  // Remember what was learned: the names matched by hand, and this file layout's column mapping.
  for (const [key, d] of Object.entries(input.decisions)) {
    if (d.action !== "existing" || !d.remember || !ownIds.has(d.customerId)) continue;
    await db.insert(customerAliases).values({ tenantId, alias: key, customerId: d.customerId }).onConflictDoUpdate({ target: [customerAliases.tenantId, customerAliases.alias], set: { customerId: d.customerId } });
  }
  await db
    .insert(importColumnMappings)
    .values({ tenantId, kind: KIND, signature, mapping: input.mapping as Record<string, string> })
    .onConflictDoUpdate({ target: [importColumnMappings.tenantId, importColumnMappings.kind, importColumnMappings.signature], set: { mapping: input.mapping as Record<string, string>, updatedAt: new Date() } });

  await logAuditEvent({ tenantId, userId, action: "sales_import", entityType: "sales_import", entityId: imp.id, after: { fileName: input.fileName, imported, total, customersCreated: created.map((c) => c.name), stopped: stopped?.message } });
  return { ok: true, importId: imp.id, imported, total, skipped, stopped, customersCreated: created.map((c) => c.name) };
}

// ------------------------------------------------------------------ history, undo, template

export async function listSalesImports(tenantId: string, limit = 15) {
  const rows = await db
    .select({
      id: salesImports.id,
      fileName: salesImports.fileName,
      invoiceCount: salesImports.invoiceCount,
      total: salesImports.total,
      status: salesImports.status,
      createdAt: salesImports.createdAt,
      active: sql<number>`(select count(*)::int from sales_invoices i where i.import_id = "sales_imports"."id" and i.status <> 'void')`,
    })
    .from(salesImports)
    .where(eq(salesImports.tenantId, tenantId))
    .orderBy(desc(salesImports.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, total: Number(r.total), createdAt: r.createdAt.toISOString() }));
}

export async function importInvoiceIds(tenantId: string, importId: string) {
  const [imp] = await db.select({ id: salesImports.id }).from(salesImports).where(and(eq(salesImports.id, importId), eq(salesImports.tenantId, tenantId))).limit(1);
  if (!imp) return null;
  const rows = await db.select({ id: salesInvoices.id, number: salesInvoices.invoiceNumber }).from(salesInvoices).where(and(eq(salesInvoices.importId, importId), ne(salesInvoices.status, "void")));
  return rows;
}

export async function markImportUndone(tenantId: string, importId: string) {
  const remaining = await importInvoiceIds(tenantId, importId);
  await db.update(salesImports).set({ status: remaining && remaining.length === 0 ? "undone" : "partly_undone" }).where(and(eq(salesImports.id, importId), eq(salesImports.tenantId, tenantId)));
}

/** A ready-to-fill workbook: the columns with two example rows, plus this organization's customers and accounts to copy names from. */
export async function buildSalesTemplate(tenantId: string): Promise<string> {
  const [customerList, accountList] = await Promise.all([
    db.select({ name: customers.name }).from(customers).where(eq(customers.tenantId, tenantId)).orderBy(customers.name),
    cashBankAccountList(tenantId),
  ]);
  const wb = XLSX.utils.book_new();
  const sales = XLSX.utils.aoa_to_sheet([
    ["Date", "Customer", "Amount", "Discount", "Bill type", "Paid amount", "Received into"],
    ["2083-04-15", customerList[0]?.name ?? "Customer name", 10000, 0, "Taxable", 0, ""],
    ["2083-04-16", "", 2500, 0, "Taxable", 2825, accountList[0]?.name ?? "Cash"],
  ]);
  sales["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, sales, "Sales");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Customers (copy names from here)"], ...customerList.map((c) => [c.name])]), "Customers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cash and bank accounts"], ...accountList.map((a) => [a.name])]), "Accounts");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["How to fill in the Sales sheet"],
      ["One row is one invoice. Only Date and Amount are needed."],
      ["Date: AD or BS (2083-04-15 or 2026-07-31)."],
      ["Amount: before VAT (or including VAT if you tell the import so)."],
      ["Customer: leave blank for a cash sale that is paid in full."],
      ["Bill type: Taxable or Zero rated. Blank uses the default you choose."],
      ["Paid amount and Received into: only if money was received."],
      ["Invoice numbers are given automatically, continuing your sequence."],
    ]),
    "How to fill in"
  );
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}
