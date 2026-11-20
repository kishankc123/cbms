import * as XLSX from "xlsx";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { items, purchaseBills, vendors, supplierAliases, type PurchaseLineItem } from "@/db/schema";
import { importedDate } from "@/lib/calendar";
import { parseStatementFile } from "@/lib/banking/parse-statement";
import { assertPeriodOpen } from "@/lib/compliance/period-lock";
import { getTaxRate } from "@/lib/compliance/tax-rates";
import { assertColumns, templateMapping, templateRows } from "@/lib/import-columns";
import { buildPaymentResolver } from "@/lib/payment-modes";
import { bestNameMatch, normalizeName, parseAmountCell } from "@/lib/sales/import/values";
import { createStockableInvoiceCore } from "@/lib/purchases/stockable-invoice";
import { isTreatment, lineVatRate, parseTreatmentCell, type LineTreatment } from "@/lib/purchases/vat-lines";
import { BILL_TYPE_LABEL, parsePurchaseBillType, type PurchaseBillTypeValue } from "./values";
import { ITEM_FIELDS } from "./item-fields";

// Importing purchases with their items: one spreadsheet row per item line, lines with the same supplier and invoice number are one bill, and every bill is
// posted through the same writer the single invoice form uses. Plain server helpers: the actions in purchases/import check the permission first.

const MAX_ROWS = 1500;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ItemImportSettings = { defaultBillType: PurchaseBillTypeValue; defaultAccountId: string | null; createSuppliers: boolean };

export type ImportLine = { rowNumber: number; item: string; quantity: number; rate: number; discount: number; treatment: LineTreatment };
export type ImportBill = {
  key: string;
  invoiceNumber: string;
  supplierText: string;
  /** The supplier it matched, or the name that would be created. */
  supplierName: string | null;
  newSupplier: boolean;
  similarTo: string | null;
  date: string | null;
  billType: PurchaseBillTypeValue | null;
  lines: ImportLine[];
  paid: number;
  total: number;
  vat: number;
  status: "ready" | "problem" | "duplicate";
  issues: string[];
};
export type ItemImportReview = { bills: ImportBill[]; counts: { ready: number; problem: number; duplicate: number }; lines: number; total: number };

function readFile(base64: string, fileName: string) {
  const parsed = parseStatementFile(base64, fileName);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) throw new Error("The file has no rows to import.");
  if (parsed.rows.length > MAX_ROWS) throw new Error(`The file has ${parsed.rows.length} rows. Import up to ${MAX_ROWS} lines at a time.`);
  return parsed;
}

type Resolved = ImportBill & { vendorId: string | null; accountId: string | null; modeId: string | null; itemIds: (string | null)[] };

/** Every bill in the file, checked, with nothing posted or created. */
async function build(tenantId: string, base64: string, fileName: string, settings: ItemImportSettings): Promise<Resolved[]> {
  const parsed = readFile(base64, fileName);
  const mapping = templateMapping(ITEM_FIELDS, parsed.headers);
  assertColumns(ITEM_FIELDS, mapping);
  const idx = Object.fromEntries(ITEM_FIELDS.map((f) => [f.key, mapping[f.key] ? parsed.headers.findIndex((h) => h === mapping[f.key]) : -1])) as Record<(typeof ITEM_FIELDS)[number]["key"], number>;
  const cell = (r: string[], k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");

  const [supplierList, aliasRows, itemList, resolver, existing] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)),
    db.select({ alias: supplierAliases.alias, vendorId: supplierAliases.vendorId }).from(supplierAliases).where(eq(supplierAliases.tenantId, tenantId)),
    db.select({ id: items.id, name: items.name, treatment: items.purchaseVatTreatment }).from(items).where(and(eq(items.tenantId, tenantId), eq(items.isActive, true), eq(items.inventoryTracking, true))),
    buildPaymentResolver(tenantId),
    db.select({ vendorId: purchaseBills.vendorId, number: purchaseBills.billNumber }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, tenantId), ne(purchaseBills.status, "void"))),
  ]);
  const supplierByName = new Map(supplierList.map((s) => [normalizeName(s.name), s]));
  const supplierByAlias = new Map(aliasRows.map((a) => [a.alias, a.vendorId]));
  const supplierById = new Map(supplierList.map((s) => [s.id, s]));
  const itemByName = new Map(itemList.map((i) => [normalizeName(i.name), i]));
  const taken = new Set(existing.map((e) => `${e.vendorId ?? ""}|${e.number.toLowerCase()}`));
  const defaultAccount = settings.defaultAccountId ? resolver.accounts.find((a) => a.id === settings.defaultAccountId) ?? null : null;

  const groups = new Map<string, { rows: { r: string[]; rowNumber: number }[] }>();
  parsed.rows.forEach((r, i) => {
    if (r.every((c) => (c ?? "").trim() === "")) return;
    const key = `${normalizeName(cell(r, "supplier"))}|${cell(r, "invoiceNumber").toLowerCase()}`;
    const g = groups.get(key) ?? { rows: [] };
    g.rows.push({ r, rowNumber: i + 2 });
    groups.set(key, g);
  });

  const lockedByDate = new Map<string, boolean>();
  const vatByDate = new Map<string, number>();
  const out: Resolved[] = [];
  for (const [key, g] of groups) {
    const first = g.rows[0].r;
    const issues: string[] = [];
    const invoiceNumber = cell(first, "invoiceNumber");
    if (!invoiceNumber) issues.push(`Row ${g.rows[0].rowNumber}: the invoice number is blank. Lines of one bill share an invoice number.`);

    // Supplier
    const supplierText = cell(first, "supplier");
    let vendorId: string | null = null;
    let supplierName: string | null = null;
    let newSupplier = false;
    let similarTo: string | null = null;
    if (supplierText) {
      const sKey = normalizeName(supplierText);
      const matched = supplierByName.get(sKey)?.id ?? supplierByAlias.get(sKey) ?? null;
      if (matched) {
        vendorId = matched;
        supplierName = supplierById.get(matched)?.name ?? supplierText;
      } else if (settings.createSuppliers) {
        newSupplier = true;
        supplierName = supplierText.replace(/\s+/g, " ").slice(0, 120);
        similarTo = bestNameMatch(supplierText, supplierList)?.match.name ?? null;
      } else {
        issues.push(`The supplier "${supplierText}" is not in your suppliers.`);
      }
    }

    // Date: every line of a bill must agree.
    const d = importedDate(cell(first, "date"));
    const date = d.iso ?? null;
    if (!date) issues.push(`Row ${g.rows[0].rowNumber}: ${d.error ?? (cell(first, "date") ? "the date can't be read." : "there is no date.")}`);
    else {
      if (g.rows.some(({ r }) => importedDate(cell(r, "date")).iso !== date)) issues.push("The lines of this bill have different dates.");
      if (!lockedByDate.has(date)) {
        lockedByDate.set(date, await assertPeriodOpen(tenantId, date).then(() => false, () => true));
        vatByDate.set(date, await getTaxRate(tenantId, "vat", date));
      }
      if (lockedByDate.get(date)) issues.push(`The period of ${date} is closed.`);
    }

    // Bill type
    const typeText = cell(first, "billType");
    const parsedType = parsePurchaseBillType(typeText);
    if (parsedType === null) issues.push(`"${typeText}" is not a bill type. Use VAT, PAN, estimate, challan or no bill.`);
    const billType = parsedType === null ? null : parsedType ?? settings.defaultBillType;

    // Lines
    const lines: ImportLine[] = [];
    const itemIds: (string | null)[] = [];
    for (const { r, rowNumber } of g.rows) {
      const itemText = cell(r, "item");
      const found = itemByName.get(normalizeName(itemText));
      if (!itemText) issues.push(`Row ${rowNumber}: no item.`);
      else if (!found) {
        const near = bestNameMatch(itemText, itemList, 0.7)?.match.name;
        issues.push(`Row ${rowNumber}: "${itemText}" is not a stock item${near ? `. Did you mean "${near}"?` : "."}`);
      }
      const qty = parseAmountCell(cell(r, "quantity"));
      const rate = parseAmountCell(cell(r, "rate"));
      const disc = parseAmountCell(cell(r, "discount"));
      if (qty.invalid || qty.value === null || qty.value <= 0) issues.push(`Row ${rowNumber}: the quantity must be a number above zero.`);
      if (rate.invalid || rate.value === null || rate.value <= 0) issues.push(`Row ${rowNumber}: the rate must be a number above zero.`);
      if (disc.invalid) issues.push(`Row ${rowNumber}: the discount can't be read.`);
      const t = parseTreatmentCell(cell(r, "vat"));
      if (t === null) issues.push(`Row ${rowNumber}: "${cell(r, "vat")}" is not a VAT treatment. Use taxable, zero-rated or exempt.`);
      const treatment: LineTreatment = t ?? (found && isTreatment(found.treatment) ? found.treatment : "taxable");
      lines.push({ rowNumber, item: found?.name ?? itemText, quantity: qty.value ?? 0, rate: rate.value ?? 0, discount: disc.value ?? 0, treatment });
      itemIds.push(found?.id ?? null);
    }

    // Payment: the amount may sit on any line of the bill.
    let paid = 0;
    let accountText = "";
    for (const { r, rowNumber } of g.rows) {
      const p = parseAmountCell(cell(r, "paid"));
      if (p.invalid) issues.push(`Row ${rowNumber}: the paid amount can't be read.`);
      if (p.value) paid += p.value;
      if (!accountText) accountText = cell(r, "account");
    }
    paid = round2(paid);
    let accountId: string | null = null;
    let modeId: string | null = null;
    if (paid > 0) {
      if (accountText) {
        const pick = resolver.resolve(accountText);
        if (pick && "accountId" in pick) {
          accountId = pick.accountId;
          modeId = pick.modeId;
        } else issues.push(`The account "${accountText}" ${pick ? "has several accounts: name the account" : "is not a cash or bank account"}.`);
      } else if (defaultAccount) accountId = defaultAccount.id;
      else issues.push("It was paid, but no account is named and there is no default account.");
    }

    // Totals, the way the invoice writer will work them out.
    const vatRate = date ? vatByDate.get(date) ?? 0 : 0;
    let subtotal = 0;
    let vat = 0;
    for (const l of lines) {
      const gross = round2(l.rate * l.quantity);
      const taxable = round2(gross - Math.min(Math.max(l.discount, 0), gross));
      subtotal += taxable;
      vat += round2(taxable * (lineVatRate(billType ?? "no_bill", l.treatment, vatRate) / 100));
    }
    const total = round2(subtotal + vat);
    if (paid > total + 0.004) issues.push("The paid amount is more than the bill.");

    const dupe = invoiceNumber && taken.has(`${vendorId ?? ""}|${invoiceNumber.toLowerCase()}`);
    const status: ImportBill["status"] = dupe ? "duplicate" : issues.length > 0 ? "problem" : "ready";
    if (dupe) issues.unshift(`Invoice ${invoiceNumber} is already recorded${supplierName ? ` for ${supplierName}` : ""}.`);
    out.push({ key, invoiceNumber, supplierText, supplierName, newSupplier, similarTo, date, billType, lines, paid, total, vat: round2(vat), status, issues, vendorId, accountId, modeId, itemIds });
  }
  return out;
}

// The review shows what the person needs; the ids stay on the server.
const publicBill = (b: Resolved): ImportBill => ({ key: b.key, invoiceNumber: b.invoiceNumber, supplierText: b.supplierText, supplierName: b.supplierName, newSupplier: b.newSupplier, similarTo: b.similarTo, date: b.date, billType: b.billType, lines: b.lines, paid: b.paid, total: b.total, vat: b.vat, status: b.status, issues: b.issues });

export async function reviewItemFile(tenantId: string, base64: string, fileName: string, settings: ItemImportSettings): Promise<ItemImportReview> {
  const bills = (await build(tenantId, base64, fileName, settings)).map(publicBill);
  return {
    bills,
    counts: { ready: bills.filter((b) => b.status === "ready").length, problem: bills.filter((b) => b.status === "problem").length, duplicate: bills.filter((b) => b.status === "duplicate").length },
    lines: bills.reduce((s, b) => s + b.lines.length, 0),
    total: round2(bills.filter((b) => b.status === "ready").reduce((s, b) => s + b.total, 0)),
  };
}

export type ItemChunkResult = { created: number; failed: { invoiceNumber: string; error: string }[] };

/** Posts the bills with the given keys (those that are ready), creating a supplier first when it is new. A bill that fails is reported and the rest carry on. */
export async function importItemBills(ctx: { tenantId: string; userId: string }, base64: string, fileName: string, settings: ItemImportSettings, keys: string[]): Promise<ItemChunkResult> {
  const wanted = new Set(keys);
  const bills = (await build(ctx.tenantId, base64, fileName, settings)).filter((b) => wanted.has(b.key) && b.status === "ready");
  const result: ItemChunkResult = { created: 0, failed: [] };
  for (const b of bills) {
    try {
      let vendorId = b.vendorId;
      if (b.newSupplier && b.supplierName) {
        const [same] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.tenantId, ctx.tenantId), eq(vendors.name, b.supplierName))).limit(1);
        vendorId = same?.id ?? (await db.insert(vendors).values({ tenantId: ctx.tenantId, name: b.supplierName, openingBalance: "0" }).returning({ id: vendors.id }))[0].id;
      }
      const lines: PurchaseLineItem[] = b.lines.map((l, i) => ({
        itemId: b.itemIds[i],
        description: l.item,
        rate: l.rate,
        quantity: l.quantity,
        discount: l.discount,
        ...(b.billType === "vat" && l.treatment !== "taxable" ? { taxTreatment: l.treatment } : {}),
      }));
      await createStockableInvoiceCore(ctx, {
        invoiceNumber: b.invoiceNumber,
        invoiceDate: b.date as string,
        vendorId: vendorId ?? "",
        billType: (b.billType ?? settings.defaultBillType) as never,
        lines,
        payments: b.paid > 0 && b.accountId ? [{ accountId: b.accountId, amount: b.paid, modeId: b.modeId }] : [],
      });
      result.created++;
    } catch (e) {
      result.failed.push({ invoiceNumber: b.invoiceNumber, error: e instanceof Error ? e.message : "Could not be saved" });
    }
  }
  return result;
}

/** The sheet to fill in: the columns, two sample bills (the second a mixed VAT bill), and the names that can be used. */
export async function buildItemTemplate(tenantId: string): Promise<string> {
  const [supplierList, itemList, resolver] = await Promise.all([
    db.select({ name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId)).orderBy(vendors.name),
    db.select({ name: items.name }).from(items).where(and(eq(items.tenantId, tenantId), eq(items.isActive, true), eq(items.inventoryTracking, true))).orderBy(items.name),
    buildPaymentResolver(tenantId),
  ]);
  const i1 = itemList[0]?.name ?? "Item name";
  const i2 = itemList[1]?.name ?? i1;
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(
    templateRows(ITEM_FIELDS, [
      { date: "15/04/2083", supplier: supplierList[0]?.name ?? "Supplier name", invoiceNumber: "B-101", billType: "VAT", item: i1, quantity: 10, rate: 250, discount: 0, vat: "Taxable", paid: 0 },
      { date: "15/04/2083", supplier: supplierList[0]?.name ?? "Supplier name", invoiceNumber: "B-101", billType: "VAT", item: i2, quantity: 4, rate: 1200, discount: 100, vat: "Zero-rated" },
      { date: "16/04/2083", supplier: supplierList[1]?.name ?? "Another supplier", invoiceNumber: "B-102", billType: "PAN", item: i1, quantity: 6, rate: 250, paid: 1500, account: resolver.accounts[0]?.name ?? "Cash" },
    ])
  );
  sheet["!cols"] = ITEM_FIELDS.map((f) => ({ wch: f.key === "supplier" || f.key === "item" ? 28 : f.key === "account" ? 22 : 14 }));
  XLSX.utils.book_append_sheet(wb, sheet, "Purchases");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Suppliers (copy names from here)"], ...supplierList.map((s) => [s.name])]), "Suppliers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Stock items (names must match)"], ...itemList.map((i) => [i.name])]), "Items");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cash and bank accounts"], ...resolver.accounts.map((a) => [a.name])]), "Accounts");
  const guide = XLSX.utils.aoa_to_sheet([["Column", "Required", "What to put"], ...ITEM_FIELDS.map((f) => [f.label, f.required ? "Yes" : "No", f.help])]);
  guide["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guide, "Columns");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["How to fill in the Purchases sheet"],
      ["One row for each item bought. Rows with the same supplier and invoice number make one bill."],
      ["Bill type, date and supplier are read from the first row of a bill."],
      ["On a VAT bill, the VAT treatment column says which items carry VAT, are zero-rated, or exempt. Blank is taxable, or what the item is set to."],
      ["Put the Paid amount (and account) on any one row of the bill."],
      ["Delete the sample rows before you upload."],
    ])
  );
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

export { BILL_TYPE_LABEL };
