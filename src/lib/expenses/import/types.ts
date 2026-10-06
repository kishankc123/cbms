import type { ExpenseColumnMapping, ExpenseFieldKey } from "./fields";
import type { ExpenseRowIssue, ExpenseRowStatus } from "./checks";
import type { CategoryDecision, CategoryGroup, PurchaseDateOptions, PurchaseFileAnalysis, PurchaseImportSettings, SupplierDecision, SupplierGroup } from "@/lib/purchases/import/types";
import type { PurchaseBillTypeValue } from "@/lib/purchases/import/values";

// The shapes passed between the Import Expenses screen and its server actions. Settings, decisions, groups and the steps of
// the posting are the same as Import Purchases, so those types are shared.

export type ExpenseImportSettings = PurchaseImportSettings;
export type ExpenseDateOptions = PurchaseDateOptions;
export type ExpenseFileAnalysis = Omit<PurchaseFileAnalysis, "mapping"> & { mapping: ExpenseColumnMapping };
export type ExpenseOverrides = Record<number, Partial<Record<ExpenseFieldKey, string>>>;

export type ExpenseReviewRow = {
  rowNumber: number;
  raw: Partial<Record<ExpenseFieldKey, string>>;
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
  status: ExpenseRowStatus;
  issues: ExpenseRowIssue[];
  messages: string[];
  total: number | null;
  tax: number | null;
};

export type ExpenseReviewResult = {
  rows: ExpenseReviewRow[];
  supplierGroups: SupplierGroup[];
  categoryGroups: CategoryGroup[];
  counts: { ready: number; attention: number; duplicate: number; skipped: number };
  fileTotal: number;
  importTotal: number;
  importTax: number;
  dates: ExpenseFileAnalysis["dates"];
};

export type ExpenseRunInput = {
  fileName: string;
  base64: string;
  mapping: ExpenseColumnMapping;
  dateOptions: ExpenseDateOptions;
  settings: ExpenseImportSettings;
  supplierDecisions: Record<string, SupplierDecision>;
  categoryDecisions: Record<string, CategoryDecision>;
  skipRows: number[];
  includeDuplicates: boolean;
  overrides?: ExpenseOverrides;
};

export type ExpenseCheckResult = { wouldImport: number; total: number; tax: number; suppliersToCreate: string[]; skipped: { rowNumber: number; reason: string }[] };
