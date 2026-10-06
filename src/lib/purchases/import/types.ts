import type { ImportDateChoice } from "@/lib/banking/import-dates";
import type { PurchaseRowIssue, PurchaseRowStatus } from "./checks";
import type { PurchaseColumnMapping, PurchaseFieldKey } from "./fields";
import type { PurchaseBillTypeValue } from "./values";

// The shapes passed between the Import Purchases screen and its server actions.

export type PurchaseImportSettings = {
  /** Amounts in the file already include VAT (only meaningful for VAT bills). */
  amountsIncludeVat: boolean;
  defaultBillType: PurchaseBillTypeValue;
  paidMode: "file" | "unpaid" | "full";
  /** Used when money was paid and the file doesn't name the account. */
  defaultAccountId: string | null;
  /** Used when the file has no category, or the cell is blank. */
  defaultCategoryId: string | null;
};

export type PurchaseOverrides = Record<number, Partial<Record<PurchaseFieldKey, string>>>;
export type PurchaseDateOptions = { choice: ImportDateChoice; dayFirst: boolean; allowMixed: boolean };

export type PurchaseFileAnalysis = {
  headers: string[];
  sample: string[][];
  rowCount: number;
  mapping: PurchaseColumnMapping;
  remembered: boolean;
  mappingComplete: boolean;
  dates: { detected: string; confidence: number; mixed: boolean; blocking: boolean; problemCount: number; dayMonthAmbiguity: boolean };
};

export type PurchaseReviewRow = {
  rowNumber: number;
  raw: Partial<Record<PurchaseFieldKey, string>>;
  dateIso: string | null;
  dateRaw: string;
  supplierText: string;
  supplierName: string | null;
  supplierKey: string | null;
  categoryText: string;
  categoryName: string | null;
  categoryKey: string | null;
  amount: number | null;
  paid: number;
  billType: PurchaseBillTypeValue | null;
  status: PurchaseRowStatus;
  issues: PurchaseRowIssue[];
  messages: string[];
  total: number | null;
  tax: number | null;
};

export type SupplierGroup = { key: string; text: string; rows: number; total: number; suggestion: { vendorId: string; name: string; score: number } | null };
export type CategoryGroup = { key: string; text: string; rows: number; total: number; suggestion: { categoryId: string; name: string; score: number } | null };

export type PurchaseReviewResult = {
  rows: PurchaseReviewRow[];
  supplierGroups: SupplierGroup[];
  categoryGroups: CategoryGroup[];
  counts: { ready: number; attention: number; duplicate: number; skipped: number };
  fileTotal: number;
  importTotal: number;
  importTax: number;
  dates: PurchaseFileAnalysis["dates"];
};

export type SupplierDecision = { action: "existing"; vendorId: string; remember: boolean } | { action: "create"; name: string } | { action: "skip" };
export type CategoryDecision = { action: "existing"; categoryId: string } | { action: "skip" };

export type PurchaseRunInput = {
  fileName: string;
  base64: string;
  mapping: PurchaseColumnMapping;
  dateOptions: PurchaseDateOptions;
  settings: PurchaseImportSettings;
  supplierDecisions: Record<string, SupplierDecision>;
  categoryDecisions: Record<string, CategoryDecision>;
  skipRows: number[];
  includeDuplicates: boolean;
  overrides?: PurchaseOverrides;
};

export type PurchaseCheckResult = { wouldImport: number; total: number; tax: number; suppliersToCreate: string[]; skipped: { rowNumber: number; reason: string }[] };

/** Step one of an import: everything decided and set up, and the list of rows to post (in chunks, so it can't time out). */
export type PreparedImport =
  | {
      ok: true;
      importId: string;
      /** The decisions with ticked suppliers now created, so the chunks need not create anything. */
      supplierDecisions: Record<string, SupplierDecision>;
      rowNumbers: number[];
      skipped: { rowNumber: number; reason: string }[];
      suppliersCreated: string[];
    }
  | { ok: false; error: string };

export type ChunkResult = { ok: true; imported: number; total: number; stopped: { rowNumber: number; message: string } | null } | { ok: false; error: string };

export type FinishedImport = { imported: number; total: number };
