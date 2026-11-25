import { describe, expect, it } from "vitest";
import { backTarget } from "./back-target";

const id = "972a73de-4b88-4fef-bc4a-7cb38b912e5c";

describe("where the back button goes", () => {
  it("has none on a section page or a tab of one", () => {
    for (const p of ["/dashboard", "/sales", "/customers", "/suppliers", "/payroll/employees", "/assets/setup", "/compliance/calendar", "/payments/money-out", "/audit/periods"]) expect(backTarget(p)).toBeNull();
  });

  it("takes a report back to the list of reports, and a page under a report back to the report", () => {
    expect(backTarget("/reports/ledger")).toEqual({ href: "/reports", label: "Back to Reports" });
    expect(backTarget("/reports/daybook/range")).toEqual({ href: "/reports/daybook", label: "Back to Daybook" });
    expect(backTarget("/reports")).toBeNull();
  });

  it("takes a record back to its list", () => {
    expect(backTarget(`/suppliers/${id}`)).toEqual({ href: "/suppliers", label: "Back to Suppliers" });
    expect(backTarget(`/customers/${id}`)).toEqual({ href: "/customers", label: "Back to Customers" });
    expect(backTarget(`/payroll/employees/${id}`)).toEqual({ href: "/payroll/employees", label: "Back to Employees" });
    expect(backTarget(`/payroll/payslips/${id}`)).toEqual({ href: "/payroll/salary-sheet", label: "Back to the salary sheet" });
    expect(backTarget(`/inventory/stock/${id}`)?.href).toBe("/inventory/stock");
    expect(backTarget(`/suppliers/reconcile/${id}`)?.href).toBe("/suppliers/reconcile");
  });

  it("takes a new page back to its list and an edit page back to the record", () => {
    expect(backTarget("/settings/users/new")?.href).toBe("/settings/users");
    expect(backTarget("/payments/inter-transfer/new")?.href).toBe("/payments/inter-transfer");
    expect(backTarget(`/payments/inter-transfer/${id}/edit`)?.href).toBe(`/payments/inter-transfer/${id}`);
  });

  it("takes settings and dashboard pages back to their landing page, and bank reconciliation screens to the accounts", () => {
    expect(backTarget("/settings/company")).toEqual({ href: "/settings", label: "Back to Settings" });
    expect(backTarget("/dashboard/forecast")?.href).toBe("/dashboard");
    expect(backTarget(`/bank-reconciliation/${id}/cash`)?.href).toBe("/bank-reconciliation");
    expect(backTarget("/bank-reconciliation/setup")?.href).toBe("/bank-reconciliation");
    expect(backTarget("/bank-reconciliation")).toBeNull();
  });
});
