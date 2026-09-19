import crypto from "crypto";

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

function parseDate(cell: string | undefined): string | null {
  if (!cell) return null;
  const trimmed = cell.trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY — assume DD/MM/YYYY (most bank
  // exports in this app's target market use day-first dates).
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function columnIndex(headers: string[], name: string | undefined): number {
  if (!name) return -1;
  return headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
}

// Applies a column mapping to raw parsed rows, producing signed amounts and
// a dedupe hash per row — the mapping is resolved once per import, not
// hard-coded to any particular bank's column names.
export function normalizeStatementRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping
): { valid: NormalizedStatementRow[]; skipped: number } {
  const dateIdx = columnIndex(headers, mapping.date);
  const descIdx = columnIndex(headers, mapping.description);
  const debitIdx = columnIndex(headers, mapping.debit);
  const creditIdx = columnIndex(headers, mapping.credit);
  const amountIdx = columnIndex(headers, mapping.amount);
  const referenceIdx = columnIndex(headers, mapping.reference);
  const balanceIdx = columnIndex(headers, mapping.balance);

  const valid: NormalizedStatementRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const transactionDate = parseDate(dateIdx >= 0 ? row[dateIdx] : undefined);
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

  return { valid, skipped };
}
