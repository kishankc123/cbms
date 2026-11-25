// Where the round back button in the top bar goes: the page one level up, not the page you came from, so it is always the same and always makes sense.
// Section pages (Sales, Purchases, the tabs of a section...) have none: they are on the sidebar already.

export type BackTarget = { href: string; label: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names for the pages a back button can go to. */
const LABELS: Record<string, string> = {
  "/reports": "Reports",
  "/reports/daybook": "Daybook",
  "/dashboard": "Dashboard",
  "/settings": "Settings",
  "/customers": "Customers",
  "/suppliers": "Suppliers",
  "/suppliers/reconcile": "supplier statements",
  "/payroll/employees": "Employees",
  "/payroll/salary-sheet": "the salary sheet",
  "/payroll/incentives": "Incentives",
  "/inventory/stock": "Stock",
  "/assets": "Assets",
  "/settings/users": "Users",
  "/settings/roles": "Roles",
  "/payments/inter-transfer": "Inter-transfers",
  "/expenses/recurring": "Recurring Expenses",
  "/bank-reconciliation": "bank accounts",
};

const titled = (path: string) => {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
};

const to = (href: string): BackTarget => ({ href, label: `Back to ${LABELS[href] ?? titled(href)}` });

/** The page above this one, or null when it has no back button (a section page, or the page is not one that goes deeper). */
export function backTarget(pathname: string): BackTarget | null {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];

  // A report goes back to the list of reports; a report with a page of its own under it goes back to that report.
  if (parts[0] === "reports") return parts.length === 2 ? to("/reports") : to("/" + parts.slice(0, -1).join("/"));
  // The dashboard's detail screens and the Settings pages go back to their landing page.
  if ((parts[0] === "dashboard" || parts[0] === "settings") && parts.length === 2) return to("/" + parts[0]);

  // Bank Reconciliation: an account's screens and the setup page go back to the list of accounts.
  if (parts[0] === "bank-reconciliation") return to("/bank-reconciliation");

  // An edit page goes back to the record it edits.
  if (last === "edit" && parts.length >= 3) return to("/" + parts.slice(0, -1).join("/"));
  // A record (an id) or a "new" page goes back to the list it belongs to.
  if (ID.test(last) || last === "new") {
    const up = "/" + parts.slice(0, -1).join("/");
    // A payslip belongs to its salary run's sheet.
    if (up === "/payroll/payslips") return to("/payroll/salary-sheet");
    return to(up);
  }
  return null;
}
