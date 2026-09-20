import crypto from "crypto";
import { resolveImportDates, type ImportDateChoice, type ImportDateResult } from "./import-dates";

export type ColumnMapping = {
  date: string;
  description?: string;
  debit?: string;
  credit?: string;
  amount?: string;
  reference?: string;
  balance?: string;
};

export type NormalizedStatementRow = {
  transactionDate: string; // YYYY-MM-DD
  description: string;
  reference: string;
  amount: number; // signed: positive = money in, negative = money out
  runningBalance: number | null;
  dedupeHash: string;
  raw: string[];
};

function parseAmount(cell: string | undefined): number {
  if (!cell) return 0;
  const cleaned = cell.replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function columnIndex(headers: string[], name: string | undefined): number {
  if (!name) return -1;
  return headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
}

// Applies a column mapping to raw parsed rows, producing signed amounts and
// a dedupe hash per row — the mapping is resolved once per import, not
// hard-coded to any particular bank's column names.
export type DateImportOptions = { choice?: ImportDateChoice; dayFirst?: boolean; allowMixed?: boolean };

export function normalizeStatementRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
  dateOptions: DateImportOptions = {}
): { valid: NormalizedStatementRow[]; skipped: number; dates: ImportDateResult } {
  const dateIdx = columnIndex(headers, mapping.date);
  const descIdx = columnIndex(headers, mapping.description);
  const debitIdx = columnIndex(headers, mapping.debit);
  const creditIdx = columnIndex(headers, mapping.credit);
  const amountIdx = columnIndex(headers, mapping.amount);
  const referenceIdx = columnIndex(headers, mapping.reference);
  const balanceIdx = columnIndex(headers, mapping.balance);

  // Dates may be AD or BS in the file; resolved once for the whole column, always to AD.
  const dates = resolveImportDates(
    rows.map((r) => (dateIdx >= 0 ? r[dateIdx] : undefined)),
    { header: mapping.date, ...dateOptions }
  );

  const valid: NormalizedStatementRow[] = [];
  let skipped = 0;

  for (const [rowIndex, row] of rows.entries()) {
    const transactionDate = dates.rows[rowIndex]?.iso ?? null;
    if (!transactionDate) {
      skipped++;
      continue;
    }

    const description = descIdx >= 0 ? (row[descIdx] ?? "").trim() : "";
    const reference = referenceIdx >= 0 ? (row[referenceIdx] ?? "").trim() : "";
    const runningBalance = balanceIdx >= 0 ? parseAmount(row[balanceIdx]) : null;

    let amount: number;
    if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = debitIdx >= 0 ? parseAmount(row[debitIdx]) : 0;
      const credit = creditIdx >= 0 ? parseAmount(row[creditIdx]) : 0;
      amount = credit - Math.abs(debit);
    } else {
      amount = parseAmount(amountIdx >= 0 ? row[amountIdx] : undefined);
    }

    if (amount === 0) {
      skipped++;
      continue;
    }

    const dedupeHash = crypto
      .createHash("sha256")
      .update(`${transactionDate}|${amount.toFixed(2)}|${description}|${reference}`)
      .digest("hex");

    valid.push({ transactionDate, description, reference, amount, runningBalance, dedupeHash, raw: row });
  }

  return { valid, skipped, dates };
}
