import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, complianceObligations, notificationStates, payrollRuns, purchaseBills } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { postJournalEntry } from "@/lib/ledger/post";
import { getOrCreateRetirementPayable } from "@/lib/ledger/retirement-accounts";
import { applyState, loadNotifications, loadStates, saveState } from "./notifications";

let org: Awaited<ReturnType<typeof createTempOrg>>;
const today = "2026-11-06";
const all = () => true;
const keysOf = async (allowed: (k: string) => boolean = all) => (await loadNotifications(org.tenantId, today, allowed)).map((n) => n.key).sort();

beforeAll(async () => {
  org = await createTempOrg("ZZ Notifications");
  // a purchase waiting for item details
  await db.insert(purchaseBills).values({ tenantId: org.tenantId, billNumber: "N-1", billDate: "2026-10-20", subtotal: "1000", total: "1000", status: "open", purchaseType: "credit", detailsPending: true });
  // a payroll run that was approved but not finalized
  await db.insert(payrollRuns).values({ tenantId: org.tenantId, calendarSystem: "AD", month: 9, year: 2026, periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "approved", createdBy: org.userId });
  // a compliance item past its date
  await db.insert(complianceObligations).values({ tenantId: org.tenantId, name: "VAT return", categoryKey: "tax", taxTypeKey: "vat", periodLabel: "Ashwin", periodStart: "2026-09-01", periodEnd: "2026-09-30", dueDate: "2026-10-25" });
  // retirement contributions owed: payroll credited the employee SSF account
  const ssf = await getOrCreateRetirementPayable(org.tenantId, "employee_ssf");
  const salaries = (await db.select().from(accounts).where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, "5200"))))[0];
  await postJournalEntry({ tenantId: org.tenantId, entryDate: "2026-10-31", sourceType: "manual", createdBy: org.userId, lines: [{ accountId: salaries.id, debitAmount: 3300 }, { accountId: ssf.id, creditAmount: 3300 }] });
});
afterAll(async () => {
  await db.delete(notificationStates).where(eq(notificationStates.tenantId, org.tenantId));
  await org.remove();
});

describe("what the bell is built from", () => {
  it("finds each kind of thing waiting, from the books, with where to go and how long", async () => {
    const list = await loadNotifications(org.tenantId, today, all);
    const by = Object.fromEntries(list.map((n) => [n.key, n]));
    expect(by.details_pending).toMatchObject({ group: "verify", count: 1, amount: 1000, href: "/purchases/stockable" });
    expect(by.payroll_runs).toMatchObject({ group: "verify", count: 1, sinceDays: 37 });
    expect(by.payroll_runs.title).toMatch(/approved, not finalized/);
    expect(by.payroll_runs.href).toMatch(/^\/payroll\/salary-sheet\//);
    expect(by.contributions_owed).toMatchObject({ group: "due", amount: 3300, href: "/payroll/contributions" });
    expect(by.compliance_overdue).toMatchObject({ group: "alert", severity: "critical", count: 1 });
  });

  it("shows a person only the kinds their role may see, and looks nothing else up", async () => {
    const noPayroll = (k: string) => !["payroll_runs", "contributions_owed"].includes(k);
    const keys = await keysOf(noPayroll);
    expect(keys).not.toContain("payroll_runs");
    expect(keys).not.toContain("contributions_owed");
    expect(keys).toContain("details_pending");
    expect(await keysOf(() => false)).toEqual([]);
  });
});

describe("a person's own choices", () => {
  it("seen and snoozed are kept per person and apply to the list; a snooze ends on its day", async () => {
    await saveState(org.tenantId, org.userId, "payroll_runs", "seen", 1, today);
    await saveState(org.tenantId, org.userId, "details_pending", "snooze1", 1, today);
    const states = await loadStates(org.tenantId, org.userId);
    expect(states.map((s) => [s.key, s.state, s.snoozedUntil, s.countAt]).sort()).toEqual([["details_pending", "snoozed", "2026-11-07", 1], ["payroll_runs", "seen", null, 1]]);

    const list = await loadNotifications(org.tenantId, today, all);
    const today_ = applyState(list, states, today);
    expect(today_.find((n) => n.key === "payroll_runs")!.seen).toBe(true);
    expect(today_.find((n) => n.key === "details_pending")).toBeUndefined();
    // tomorrow the snooze is over and it is back, unseen
    expect(applyState(list, states, "2026-11-07").find((n) => n.key === "details_pending")!.seen).toBe(false);

    // someone else in the same organization is not affected
    expect(await loadStates(org.tenantId, "00000000-0000-0000-0000-000000000000")).toEqual([]);
  });

  it("a choice is replaced by the next one, and unseen takes it away", async () => {
    await saveState(org.tenantId, org.userId, "payroll_runs", "snooze7", 2, today);
    expect((await loadStates(org.tenantId, org.userId)).find((s) => s.key === "payroll_runs")).toMatchObject({ state: "snoozed", snoozedUntil: "2026-11-13", countAt: 2 });
    await saveState(org.tenantId, org.userId, "payroll_runs", "unseen", 2, today);
    expect((await loadStates(org.tenantId, org.userId)).some((s) => s.key === "payroll_runs")).toBe(false);
  });
});
