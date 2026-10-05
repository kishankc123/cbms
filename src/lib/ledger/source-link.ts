// The last hop of drill-down: REPORT → ACCOUNT → JOURNAL ENTRY → SOURCE TRANSACTION. Every journal_entries
// row already carries the sourceType that posted it — this maps that to where a person can go look at it.
//
// Honest limitation: most modules don't yet have a per-record URL (an invoice opens in a list-page modal,
// not its own route), so most of these land on the right LIST screen rather than the exact record already
// open. That's still a real, working hop — from "a number in a report" to "the module that created it" —
// and it's additive to build on later as modules gain per-record routes, without touching this map's shape.
const SOURCE_LINKS: Record<string, { label: string; href: string }> = {
  sale: { label: "Open in Sales", href: "/sales?view=invoices" },
  sales_return: { label: "Open in Sales Returns", href: "/return/sales" },
  purchase: { label: "Open in Purchases", href: "/purchases/stockable" },
  purchase_return: { label: "Open in Purchase Returns", href: "/return/purchase" },
  asset_purchase: { label: "Open in Assets", href: "/assets" },
  asset_depreciation: { label: "Open in Depreciation", href: "/assets/depreciation" },
  asset_disposal: { label: "Open in Assets", href: "/assets/transactions" },
  asset_writeoff: { label: "Open in Assets", href: "/assets/transactions" },
  expense: { label: "Open in Expenses", href: "/expenses" },
  payment: { label: "Open in Payments", href: "/payments/money-out" },
  receipt: { label: "Open in Payments", href: "/payments/money-in" },
  manual: { label: "Open in Journal Entries", href: "/journal?history=1" },
  inter_transfer: { label: "Open in Inter-Transfer", href: "/payments/inter-transfer" },
  payroll: { label: "Open in Salary Sheet", href: "/payroll/salary-sheet" },
  tax_assessment: { label: "Open in Tax Compliance", href: "/compliance/tax" },
  bank_adjustment: { label: "Open in Bank Reconciliation", href: "/bank-reconciliation" },
  stock_adjustment: { label: "Open in Stock", href: "/inventory/stock" },
  adjustment: { label: "Open in Stock", href: "/inventory/stock" },
};

/** Where to send someone to see the record behind a journal entry, if this source type has a known screen. */
export function resolveSourceLink(sourceType: string | null | undefined): { label: string; href: string } | null {
  if (!sourceType) return null;
  return SOURCE_LINKS[sourceType] ?? null;
}
