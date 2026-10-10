// The single source of truth for what the Reports landing page shows — one entry per report the
// specification calls for, whether or not it's built yet. Adding a report later means adding one row
// here and, once it exists, flipping `built` and pointing `href` at it — nothing else about the landing
// page, search, or categorization needs to change.
export type ReportEntry = {
  title: string;
  href: string;
  built: boolean;
  /** Shown on an unbuilt card so it's clear what already backs it, if anything. */
  note?: string;
};
export type ReportCategory = { name: string; reports: ReportEntry[] };

export const REPORT_CATALOG: ReportCategory[] = [
  {
    name: "Financial Statements",
    reports: [
      { title: "Profit & Loss", href: "/reports/profit-and-loss", built: true },
      { title: "Balance Sheet", href: "/reports/balance-sheet", built: true },
      { title: "Cash Flow Statement", href: "/reports/cash-flow", built: true },
      { title: "Trial Balance", href: "/reports/trial-balance", built: true },
    ],
  },
  {
    name: "Ledger & Accounting",
    reports: [
      { title: "General Ledger", href: "/reports/ledger", built: true },
      { title: "Account Ledger", href: "/reports/ledger", built: true },
      { title: "Journal Report", href: "/reports/journal-report", built: true },
      { title: "Transaction Register", href: "/reports/transaction-register", built: true },
    ],
  },
  {
    name: "Sales & Receivables",
    reports: [
      { title: "Sales Summary", href: "/reports/sales-summary", built: true },
      { title: "Sales by Customer", href: "/reports/sales-by-customer", built: true },
      { title: "Sales by Item/Service", href: "/reports/sales-by-item", built: true },
      { title: "Receivable Ageing", href: "/reports/receivable-ageing", built: true },
      { title: "Customer Statement", href: "/reports/customer-statement", built: true },
    ],
  },
  {
    name: "Purchases & Payables",
    reports: [
      { title: "Purchase Summary", href: "/reports/purchase-summary", built: true },
      { title: "Purchase by Supplier", href: "/reports/purchase-by-supplier", built: true },
      { title: "Purchase by Item", href: "/reports/purchase-by-item", built: true },
      { title: "Payable Ageing", href: "/reports/payable-ageing", built: true },
      { title: "Supplier Statement", href: "/reports/supplier-statement", built: true },
    ],
  },
  {
    name: "Cash & Bank",
    reports: [
      { title: "Cash Book", href: "/reports/cash-book", built: true },
      { title: "Bank Book", href: "/reports/bank-book", built: true },
      { title: "Bank Reconciliation Report", href: "/reports/bank-reconciliation-report", built: true },
      { title: "Cash/Bank Movement", href: "/reports/cash-bank-movement", built: true },
      { title: "Receipts & Payments by Mode", href: "/reports/receipts-by-mode", built: true },
    ],
  },
  {
    name: "Inventory",
    reports: [
      { title: "Stock Summary", href: "/reports/stock-summary", built: true },
      { title: "Stock Valuation", href: "/inventory/stock", built: true },
      { title: "Stock Movement", href: "/inventory/stock", built: true, note: "Open a Stock card from the item list" },
      { title: "Slow/Non-moving Stock", href: "/reports/slow-moving-stock", built: true },
    ],
  },
  {
    name: "Payroll",
    reports: [
      { title: "Payroll Summary", href: "/reports/payroll-summary", built: true },
      { title: "Salary Payable", href: "/reports/salary-payable", built: true },
      { title: "Employee Salary Statement", href: "/payroll/employees", built: true, note: "Open an employee's profile" },
    ],
  },
];
