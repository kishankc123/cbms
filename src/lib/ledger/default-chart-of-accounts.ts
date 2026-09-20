import type { accountCategoryEnum } from "../../db/schema/accounts";

type Category = (typeof accountCategoryEnum.enumValues)[number];

export type DefaultAccount = {
  code: string;
  name: string;
  category: Category;
  subCategory?: string;
};

// A general-purpose small-business template. Admins can add/edit/deactivate
// accounts per tenant after onboarding (spec section 3.2).
export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  // Assets
  { code: "1000", name: "Cash", category: "asset", subCategory: "Current assets" },
  { code: "1010", name: "Bank", category: "asset", subCategory: "Current assets" },
  { code: "1100", name: "Accounts Receivable", category: "asset", subCategory: "Current assets" },
  { code: "1200", name: "Inventory", category: "asset", subCategory: "Current assets" },
  { code: "1300", name: "Tax Receivable (Input VAT)", category: "asset", subCategory: "Current assets" },
  { code: "1500", name: "Fixed Assets", category: "asset", subCategory: "Fixed assets" },

  // Liabilities
  { code: "2000", name: "Accounts Payable", category: "liability", subCategory: "Current liabilities" },
  { code: "2100", name: "Tax Payable (Output VAT)", category: "liability", subCategory: "Current liabilities" },
  { code: "2200", name: "Loans Payable", category: "liability", subCategory: "Non current liabilities" },

  // Equity
  { code: "3000", name: "Owner's Capital", category: "equity", subCategory: "Equity & reserve" },
  { code: "3100", name: "Retained Earnings", category: "equity", subCategory: "Equity & reserve" },

  // Income
  { code: "4000", name: "Sales Revenue", category: "income", subCategory: "Revenue" },
  { code: "4050", name: "Sales Returns", category: "income", subCategory: "Revenue" },
  { code: "4100", name: "Other Income", category: "income", subCategory: "Revenue" },

  // Expenses
  { code: "5000", name: "Cost of Goods Sold", category: "expense", subCategory: "Cost of goods sold" },
  { code: "5100", name: "Rent", category: "expense", subCategory: "Fixed expenses" },
  { code: "5200", name: "Salaries", category: "expense", subCategory: "Variable expenses" },
  { code: "5300", name: "Utilities", category: "expense", subCategory: "Fixed expenses" },
  { code: "5400", name: "Office Supplies", category: "expense", subCategory: "Variable expenses" },
  { code: "5900", name: "Miscellaneous Expense", category: "expense", subCategory: "Variable expenses" },
];
