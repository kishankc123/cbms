import { describe, expect, it } from "vitest";
import { buildComplianceTab, type ObligationRow } from "./compliance-tab-rules";

const today = "2026-11-07";
const range = { from: "2026-07-17", to: "2027-07-16" };
const row = (over: Partial<ObligationRow> & { id: string }): ObligationRow => ({ name: `Item ${over.id}`, categoryKey: "tax", periodLabel: "Kartik", dueDate: "2026-12-01", status: "pending", amountDue: null, filingDate: null, paymentDate: null, filedBeforeSystem: false, ...over });

describe("the counts", () => {
  const rows = [
    row({ id: "late1", dueDate: "2026-10-10" }),
    row({ id: "late2", dueDate: "2026-11-06", status: "in_progress" }),
    row({ id: "today", dueDate: "2026-11-07" }), // due today is due soon, not overdue
    row({ id: "soon", dueDate: "2026-11-14" }), // exactly 7 days
    row({ id: "next", dueDate: "2026-11-15" }),
    row({ id: "next2", dueDate: "2026-12-07" }), // exactly 30 days
    row({ id: "far", dueDate: "2026-12-08" }), // beyond 30 days: not counted, not listed
    row({ id: "done", dueDate: "2026-10-01", status: "filed", filingDate: "2026-10-03" }),
    row({ id: "na", dueDate: "2026-10-01", status: "not_applicable" }),
  ];
  const t = buildComplianceTab(rows, today, range);
  it("counts what is overdue, due in 7 days, and coming in 30 days", () => {
    expect(t.counts).toMatchObject({ overdue: 2, dueSoon: 2, coming: 2 });
  });
  it("lists overdue and the next 30 days soonest first, and leaves out what is done or far away", () => {
    expect(t.deadlines.map((d) => d.id)).toEqual(["late1", "late2", "today", "soon", "next", "next2"]);
    expect(t.deadlines.slice(0, 2).every((d) => d.status === "overdue")).toBe(true);
    expect(t.moreCount).toBe(0);
  });
});

describe("filed in this period", () => {
  it("uses the dashboard's period, only for items the organization filed itself", () => {
    const t = buildComplianceTab(
      [
        row({ id: "a", status: "filed", filingDate: "2026-09-01" }),
        row({ id: "b", status: "paid", filingDate: null, paymentDate: "2026-10-20" }),
        row({ id: "c", status: "filed", filingDate: "2026-01-01" }), // before the period
        row({ id: "d", status: "filed", filingDate: "2026-09-02", filedBeforeSystem: true }), // marked filed in the catch-up checklist
        row({ id: "e", status: "pending" }),
      ],
      today,
      range
    );
    expect(t.counts.filedInPeriod).toBe(2);
    expect(buildComplianceTab([row({ id: "a", status: "filed", filingDate: "2026-09-01" })], today, { from: "2026-10-01", to: "2026-10-31" }).counts.filedInPeriod).toBe(0);
  });
  it("does not change the open counts when the period changes", () => {
    const rows = [row({ id: "x", dueDate: "2026-10-01" }), row({ id: "y", dueDate: "2026-11-10" })];
    expect(buildComplianceTab(rows, today, range).counts).toMatchObject({ overdue: 1, dueSoon: 1 });
    expect(buildComplianceTab(rows, today, { from: "2020-01-01", to: "2020-01-31" }).counts).toMatchObject({ overdue: 1, dueSoon: 1 });
  });
});

describe("areas and amounts", () => {
  it("groups tax, and treats company, ownership and statutory items as statutory", () => {
    const t = buildComplianceTab([row({ id: "t1", dueDate: "2026-10-01" }), row({ id: "s1", categoryKey: "company" }), row({ id: "s2", categoryKey: "ownership", dueDate: "2026-10-02" }), row({ id: "s3", categoryKey: "statutory" })], today, range);
    expect(t.areas).toEqual([
      { key: "tax", label: "Tax", href: "/compliance/tax", pending: 1, overdue: 1 },
      { key: "statutory", label: "Statutory", href: "/compliance/statutory", pending: 3, overdue: 1 },
    ]);
    expect(t.deadlines.find((d) => d.id === "s1")!.href).toBe("/compliance/statutory");
  });
  it("shows the amount where there is one, and nothing where there isn't", () => {
    const t = buildComplianceTab([row({ id: "p", amountDue: 48200.456 }), row({ id: "q" })], today, range);
    expect(t.deadlines.find((d) => d.id === "p")!.amount).toBe(48200.46);
    expect(t.deadlines.find((d) => d.id === "q")!.amount).toBeNull();
  });
  it("keeps the list short and says how many more there are", () => {
    const many = Array.from({ length: 14 }, (_, i) => row({ id: `m${i}`, dueDate: "2026-11-20" }));
    const t = buildComplianceTab(many, today, range, 10);
    expect(t.deadlines).toHaveLength(10);
    expect(t.moreCount).toBe(4);
  });
});
