import { describe, it, expect } from "vitest";
import { diffChanges, mapAuditEntry, mapCapitalChange, mapLagat, type AuditRow, type HistoryContext } from "./history-map";

const ctx: HistoryContext = {
  userName: (id) => (id === "u1" ? "Asha" : "System"),
  taxTypeName: (k) => ({ vat: "VAT", tds: "TDS" })[k] ?? k,
  obligation: (id) => (id === "ob1" ? { name: "VAT Return", period: "Bhadra 2083", categoryKey: "tax" } : null),
};
const row = (over: Partial<AuditRow>): AuditRow => ({ id: "a1", userId: "u1", action: "", entityType: "", entityId: null, beforeValue: null, afterValue: null, timestamp: new Date("2026-09-20T05:00:00Z"), ...over });

describe("compliance history", () => {
  it("shows only what changed, with previous and new values", () => {
    expect(diffChanges({ a: "1", b: "same" }, { a: "2", b: "same" })).toEqual([{ field: "a", previous: "1", next: "2" }]);
    expect(diffChanges({ status: "pending" }, { status: "in_progress" })).toEqual([{ field: "Status", previous: "Pending", next: "In progress" }]);
    expect(diffChanges({ x: null }, { x: "" })).toEqual([]);
  });

  it("company details changes read as labelled before/after", () => {
    const item = mapAuditEntry(row({ action: "company_details_changed", entityType: "company_details", beforeValue: { panVatNumber: null, entityType: null }, afterValue: { panVatNumber: "123", entityType: "private_limited" } }), ctx)!;
    expect(item.category).toBe("Company");
    expect(item.by).toBe("Asha");
    expect(item.changes).toEqual([
      { field: "PAN / VAT number", previous: null, next: "123" },
      { field: "Company type", previous: null, next: "Private limited" },
    ]);
  });

  it("registration status changes keep the previous status", () => {
    const item = mapAuditEntry(row({ action: "tax_registration_changed", entityType: "tax_registration", beforeValue: { taxType: "vat", status: "pending" }, afterValue: { taxType: "vat", status: "active" } }), ctx)!;
    expect(item.title).toBe("VAT registration changed");
    expect(item.changes).toEqual([{ field: "Status", previous: "Pending", next: "Active" }]);
  });

  it("names the compliance item a status change belongs to, and carries the reason", () => {
    const item = mapAuditEntry(row({ action: "compliance_status_changed", entityType: "compliance_obligation", entityId: "ob1", beforeValue: { status: "pending" }, afterValue: { status: "not_applicable", reason: "Not VAT registered" } }), ctx)!;
    expect(item.category).toBe("Tax compliance");
    expect(item.title).toBe("Status changed: VAT Return — Bhadra 2083");
    expect(item.reason).toBe("Not VAT registered");
    expect(item.changes).toEqual([{ field: "Status", previous: "Pending", next: "Not applicable" }]);
  });

  it("ignores audit entries that are not compliance information", () => {
    expect(mapAuditEntry(row({ action: "period_closed", entityType: "accounting_period" }), ctx)).toBeNull();
  });

  it("maps capital changes with their previous and new values", () => {
    const base = { id: "c1", createdBy: "u1", createdAt: new Date("2026-09-20T06:00:00Z"), effectiveDate: "2026-09-20", shareholder: null, toShareholder: null, shares: null, amount: null, previousValue: null, newValue: null, reason: "Board decision" };
    const paidUp = mapCapitalChange({ ...base, changeType: "paid_up_capital_increase", shareholder: "Asha", previousValue: "1500000.00", newValue: "2500000.00" }, ctx.userName);
    expect(paidUp.category).toBe("Capital");
    expect(paidUp.title).toBe("Paid-up capital increased — Asha");
    expect(paidUp.changes).toEqual([{ field: "Paid-up capital", previous: "1500000.00", next: "2500000.00" }]);
    expect(paidUp.reason).toBe("Board decision");
    const transfer = mapCapitalChange({ ...base, changeType: "share_transfer", shareholder: "Asha", toShareholder: "Binod", shares: 1000, amount: "50000.00" }, ctx.userName);
    expect(transfer.changes[0].next).toContain("Binod");
  });

  it("maps Share Lagat entries, marking automatic ones as made by the system", () => {
    const auto = mapLagat({ id: "s1", status: "update_required", createdAt: new Date(), createdBy: null, reason: "Shareholder added: Asha", referenceNumber: null }, ctx.userName);
    expect(auto.by).toBe("System");
    expect(auto.title).toBe("Share Lagat update needed");
    expect(auto.changes[0].previous).toBeNull();
    const manual = mapLagat({ id: "s2", status: "updated", createdAt: new Date(), createdBy: "u1", reason: null, referenceNumber: "R-1" }, ctx.userName);
    expect(manual.changes[0]).toEqual({ field: "Share Lagat", previous: "Update needed", next: "Updated (ref R-1)" });
  });
});
