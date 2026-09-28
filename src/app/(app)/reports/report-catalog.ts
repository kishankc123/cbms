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
      { title: "Cash Flow Statement", href: "", built: false },
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
      { title: "Sales Summary", href: "", built: false },
      { title: "Sales by Customer", href: "", built: false },
      { title: "Sales by Item/Service", href: "", built: false },
      { title: "Receivable Ageing", href: "", built: false },
      { title: "Customer Statement", href: "", built: false },
    ],
  },
  {
    name: "Purchases & Payables",
    reports: [
      { title: "Purchase Summary", href: "", built: false },
      { title: "Purchase by Supplier", href: "", built: false },
      { title: "Purchase by Item", href: "", built: false },
      { title: "Payable Ageing", href: "", built: false },
      { title: "Supplier Statement", href: "", built: false },
    ],
  },
  {
    name: "Cash & Bank",
    reports: [
      { title: "Cash Book", href: "", built: false },
      { title: "Bank Book", href: "", built: false },
      { title: "Bank Reconciliation Report", href: "/bank-reconciliation", built: false, note: "The reconciliation workflow exists — not packaged as a report yet" },
      { title: "Cash/Bank Movement", href: "", built: false },
    ],
  },
  {
    name: "Inventory",
    reports: [
      { title: "Stock Summary", href: "", built: false },
      { title: "Stock Valuation", href: "/inventory/stock", built: true },
      { title: "Stock Movement", href: "/inventory/stock", built: true, note: "Open a Stock card from the item list" },
      { title: "Slow/Non-moving Stock", href: "", built: false },
    ],
  },
  {
    name: "Payroll",
    reports: [
      { title: "Payroll Summary", href: "", built: false },
      { title: "Salary Payable", href: "", built: false },
      { title: "Employee Salary Statement", href: "/payroll/employees", built: true, note: "Open an employee's profile" },
    ],
  },
];
