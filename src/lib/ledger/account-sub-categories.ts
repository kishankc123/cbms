import type { accountCategoryEnum } from "@/db/schema/accounts";

type Category = (typeof accountCategoryEnum.enumValues)[number];

// User-facing sub-categories shown in the Chart of Accounts dropdown. Each one
// maps to the underlying asset/liability/equity/income/expense category that
// the ledger (normal-balance signing, P&L/trial-balance grouping) keys off of,
// so that logic never has to change when this list does.
export const ACCOUNT_SUB_CATEGORIES: { label: string; category: Category }[] = [
  { label: "Fixed assets", category: "asset" },
  { label: "Current assets", category: "asset" },
  { label: "Equity & reserve", category: "equity" },
  { label: "Non current liabilities", category: "liability" },
  { label: "Current liabilities", category: "liability" },
  { label: "Revenue", category: "income" },
  { label: "Cost of goods sold", category: "expense" },
  { label: "Fixed expenses", category: "expense" },
  { label: "Variable expenses", category: "expense" },
];

export function categoryForSubCategory(subCategory: string): Category | undefined {
  return ACCOUNT_SUB_CATEGORIES.find((s) => s.label === subCategory)?.category;
}

/**
 * Best-effort mapping from a legacy free-text sub-category (e.g. "Non-Current
 * Asset" from the old seed data) to one of the fixed options above, so an
 * account's edit form doesn't default to an unrelated option within the same
 * base category (e.g. "Fixed assets" for what was actually a current asset).
 */
export function guessSubCategory(category: Category, legacySubCategory?: string | null): string {
  const raw = (legacySubCategory ?? "").toLowerCase();
  const isNonCurrent = raw.includes("non-current") || raw.includes("non current") || raw.includes("fixed");

  switch (category) {
    case "asset":
      return isNonCurrent ? "Fixed assets" : "Current assets";
    case "liability":
      return isNonCurrent ? "Non current liabilities" : "Current liabilities";
    case "equity":
      return "Equity & reserve";
    case "income":
      return "Revenue";
    case "expense":
      return raw.includes("cost of goods") || raw.includes("cogs") ? "Cost of goods sold" : "Fixed expenses";
  }
}
