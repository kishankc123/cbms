// The tabs inside a country's compliance setup, and which requirement categories each one shows. Adding a tab, or moving a
// category to another tab, is one line here (a new category is one row in compliance_categories).
export const COMPLIANCE_TABS = [
  { key: "overview", label: "Overview", categories: [] as string[] },
  { key: "tax", label: "Tax & rates", categories: ["tax"] },
  { key: "statutory", label: "Statutory", categories: ["statutory", "ownership", "company"] },
  { key: "local", label: "Local compliance", categories: ["local"] },
] as const;
export type ComplianceTab = (typeof COMPLIANCE_TABS)[number]["key"];
export const complianceTab = (s: string | undefined): ComplianceTab => COMPLIANCE_TABS.find((t) => t.key === s)?.key ?? "overview";
export const categoriesOf = (tab: ComplianceTab): string[] => [...COMPLIANCE_TABS.find((t) => t.key === tab)!.categories];

/** Tax types that are bookkeeping helpers, not taxes an administrator sets up here (the PAN registration, the VAT fines ledger account). */
export const NOT_TAXES = ["pan", "vat_penalty"] as const;

/** Fines that are not tied to a tax return (the excise permit renewal), so they sit under Statutory instead of a tax. */
export const STATUTORY_PENALTIES = ["excise_permit"] as const;
