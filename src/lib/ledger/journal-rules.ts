import { VOUCHER_PREFIX } from "./voucher-format";

// Which journal entries a person typed in themselves, and what each kind is called. Plain functions, no database.

export type EntryOrigin = { sourceType: string; sourceId: string | null; referenceNumber: string | null };

/** The pattern of the voucher numbers only the Journal Entries form hands out. */
export const OWN_VOUCHER_PATTERN = `^${VOUCHER_PREFIX}[0-9]+$`;

/**
 * Typed in on the Journal Entries screen: "manual", tied to no other record, and carrying a voucher number that only that form gives out. The app files some
 * of its own entries as "manual" too (a cash short or excess, a change to a reconciled document, a share transfer); those don't match.
 */
export const isOwnEntry = (e: EntryOrigin) => e.sourceType === "manual" && !e.sourceId && new RegExp(OWN_VOUCHER_PATTERN).test(e.referenceNumber ?? "");

export type EntryState = "posted" | "reversed" | "reversal";
export const entryState = (e: { isReversed: boolean; reversalOfId: string | null }): EntryState => (e.reversalOfId ? "reversal" : e.isReversed ? "reversed" : "posted");

export const SOURCE_LABELS: Record<string, string> = {
  sale: "Sales",
  purchase: "Purchases",
  expense: "Expenses",
  payment: "Payments (out)",
  receipt: "Payments (in)",
  bank_adjustment: "Bank reconciliation",
  payroll: "Payroll",
  opening_balance: "Opening balances",
  inter_transfer: "Inter-transfers",
  tax_assessment: "Tax assessments",
  sales_return: "Sales returns",
  purchase_return: "Purchase returns",
  advance_application: "Advances applied",
  stock_adjustment: "Stock adjustments",
  asset_purchase: "Asset purchases",
  asset_depreciation: "Depreciation",
  asset_disposal: "Asset disposals",
  asset_writeoff: "Asset write-offs",
};

export const sourceLabel = (e: EntryOrigin) => (isOwnEntry(e) ? "Manual" : e.sourceType === "manual" ? "Automatic" : (SOURCE_LABELS[e.sourceType] ?? e.sourceType.replace(/_/g, " ")));

export const REVERSE_REFUSAL = "This entry was made by another record, such as a sale, bill, payment or reconciliation. Void or edit that record instead, so it stays in step with your books.";
