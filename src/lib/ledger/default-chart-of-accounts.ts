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
  { code: "1000", name: "Cash", category: "asset", subCategory: "Current Asset" },
  { code: "1010", name: "Bank", category: "asset", subCategory: "Current Asset" },
  { code: "1100", name: "Accounts Receivable", category: "asset", subCategory: "Current Asset" },
  { code: "1200", name: "Inventory", category: "asset", subCategory: "Current Asset" },
  { code: "1300", name: "Tax Receivable (Input VAT)", category: "asset", subCategory: "Current Asset" },
  { code: "1500", name: "Fixed Assets", category: "asset", subCategory: "Non-Current Asset" },

  // Liabilities
  { code: "2000", name: "Accounts Payable", category: "liability", subCategory: "Current Liability" },
  { code: "2100", name: "Tax Payable (Output VAT)", category: "liability", subCategory: "Current Liability" },
  { code: "2200", name: "Loans Payable", category: "liability", subCategory: "Non-Current Liability" },

  // Equity
  { code: "3000", name: "Owner's Capital", category: "equity" },
  { code: "3100", name: "Retained Earnings", category: "equity" },

  // Income
  { code: "4000", name: "Sales Revenue", category: "income" },
  { code: "4100", name: "Other Income", category: "income" },

  // Expenses
  { code: "5000", name: "Cost of Goods Sold", category: "expense" },
  { code: "5100", name: "Rent", category: "expense" },
  { code: "5200", name: "Salaries", category: "expense" },
  { code: "5300", name: "Utilities", category: "expense" },
  { code: "5400", name: "Office Supplies", category: "expense" },
  { code: "5900", name: "Miscellaneous Expense", category: "expense" },
];
