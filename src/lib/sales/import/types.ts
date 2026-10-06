import type { CustomerState, RowIssue, RowStatus } from "./checks";
import type { ImportFieldKey, SalesColumnMapping } from "./fields";
import type { SalesBillTypeValue } from "./values";
import type { ImportDateChoice } from "@/lib/banking/import-dates";

// The shapes passed between the Import Sales screen and its server actions.

export type ImportSettings = {
  /** Amounts in the file already include VAT. */
  amountsIncludeVat: boolean;
  defaultBillType: SalesBillTypeValue;
  /** What to assume about payment: only what the paid column says, everything unpaid, or everything paid in full. */
  paidMode: "file" | "unpaid" | "full";
  /** Used when money was received and the file doesn't name the account. */
  defaultAccountId: string | null;
};

/** Corrections typed into the review: a row's cell text, by the row's number in the file, that replaces what the file says. */
export type Overrides = Record<number, Partial<Record<ImportFieldKey, string>>>;

export type DateOptions = { choice: ImportDateChoice; dayFirst: boolean; allowMixed: boolean };

export type FileAnalysis = {
  headers: string[];
  sample: string[][];
  rowCount: number;
  mapping: SalesColumnMapping;
  remembered: boolean;
  mappingComplete: boolean;
  dates: { detected: string; confidence: number; mixed: boolean; blocking: boolean; problemCount: number; dayMonthAmbiguity: boolean };
};

export type ReviewRow = {
  rowNumber: number;
  dateRaw: string;
  dateIso: string | null;
  customerText: string;
  /** The cells of this row as they now stand (the file's own text, or what was typed over it). */
  raw: Partial<Record<ImportFieldKey, string>>;
  customerName: string | null;
  customerKey: string | null;
  amount: number | null;
  paid: number;
  billType: SalesBillTypeValue | null;
  status: RowStatus;
  issues: RowIssue[];
  messages: string[];
  total: number | null;
  tax: number | null;
};

export type CustomerGroup = {
  key: string;
  text: string;
  rows: number;
  total: number;
  suggestion: { customerId: string; name: string; score: number } | null;
};

export type ReviewResult = {
  rows: ReviewRow[];
  groups: CustomerGroup[];
  counts: { ready: number; attention: number; duplicate: number; skipped: number };
  /** The sum of the file's own amount column, against what would be imported, so a difference stands out. */
  fileTotal: number;
  importTotal: number;
  importTax: number;
  dates: FileAnalysis["dates"];
  customersToCreate: number;
};

export type GroupDecision = { action: "existing"; customerId: string; remember: boolean } | { action: "create"; name: string } | { action: "skip" };

export type RunInput = {
  fileName: string;
  base64: string;
  mapping: SalesColumnMapping;
  dateOptions: DateOptions;
  settings: ImportSettings;
  decisions: Record<string, GroupDecision>;
  skipRows: number[];
  includeDuplicates: boolean;
  overrides?: Overrides;
};

/** What an import would do, worked out without posting anything. */
export type CheckResult = {
  wouldImport: number;
  total: number;
  tax: number;
  customersToCreate: string[];
  skipped: { rowNumber: number; reason: string }[];
};

export type RunResult =
  | {
      ok: true;
      importId: string;
      imported: number;
      total: number;
      skipped: { rowNumber: number; reason: string }[];
      stopped: { rowNumber: number; message: string } | null;
      customersCreated: string[];
    }
  | { ok: false; error: string };

export type { CustomerState };
