import { describe, expect, it } from "vitest";
import { applyState, countsByGroup, hasCriticalUnseen, NOTIF_KEYS, NOTIF_MODULE, sortNotifs, unseenCount, type Notif, type NotifState } from "./notification-rules";

const n = (over: Partial<Notif> & { key: string }): Notif => ({ group: "verify", severity: "action", title: over.key, detail: "", href: "/x", count: 3, amount: null, sinceDays: null, ...over });
const today = "2026-11-06";

describe("a person's choices", () => {
  const list = [n({ key: "draft_bills", count: 3 }), n({ key: "trial_balance", severity: "critical", group: "alert", count: 1 })];

  it("shows everything unseen when nothing has been chosen", () => {
    expect(applyState(list, [], today).map((x) => x.seen)).toEqual([false, false]);
  });

  it("a seen item stays shown but marked seen, and the badge stops counting it", () => {
    const states: NotifState[] = [{ key: "draft_bills", state: "seen", snoozedUntil: null, countAt: 3 }];
    const v = applyState(list, states, today);
    expect(v.find((x) => x.key === "draft_bills")!.seen).toBe(true);
    expect(unseenCount(v)).toBe(1);
  });

  it("a seen item comes back unseen when more things are behind it than when it was seen", () => {
    const states: NotifState[] = [{ key: "draft_bills", state: "seen", snoozedUntil: null, countAt: 2 }];
    expect(applyState(list, states, today)[0].seen).toBe(false);
  });

  it("a snoozed item is left out until its date, then returns", () => {
    const snoozed: NotifState = { key: "draft_bills", state: "snoozed", snoozedUntil: "2026-11-07", countAt: 3 };
    expect(applyState(list, [snoozed], today).map((x) => x.key)).toEqual(["trial_balance"]);
    expect(applyState(list, [snoozed], "2026-11-07").find((x) => x.key === "draft_bills")!.seen).toBe(false); // snoozed on the 6th for a day: back on the 7th
  });

  it("a snoozed item returns early when the problem grows", () => {
    const snoozed: NotifState = { key: "draft_bills", state: "snoozed", snoozedUntil: "2026-11-20", countAt: 2 };
    expect(applyState(list, [snoozed], today).map((x) => x.key)).toContain("draft_bills");
  });
});

describe("order and counts", () => {
  const list = applyState(
    [n({ key: "a", severity: "info", sinceDays: 9 }), n({ key: "b", severity: "critical", group: "alert", sinceDays: 1 }), n({ key: "c", severity: "action", sinceDays: 7 }), n({ key: "d", severity: "action", sinceDays: 2 }), n({ key: "e", group: "due", severity: "action" })],
    [],
    today
  );
  it("puts critical first, then action, then information, longest waiting first within each", () => {
    expect(sortNotifs(list).map((x) => x.key)).toEqual(["b", "c", "d", "e", "a"]);
  });
  it("counts what is unseen, in total and by group, and says when a critical one is unseen", () => {
    expect(countsByGroup(list)).toEqual({ all: 5, verify: 3, due: 1, alert: 1 });
    expect(hasCriticalUnseen(list)).toBe(true);
    expect(hasCriticalUnseen(applyState(list, [{ key: "b", state: "seen", snoozedUntil: null, countAt: 3 }], today))).toBe(false);
  });
});

describe("who sees what", () => {
  it("every kind of notification names the module a person needs to see it", () => {
    for (const key of NOTIF_KEYS) expect(NOTIF_MODULE[key].module).toBeTruthy();
    expect(NOTIF_MODULE.payroll_runs.salary).toBe(true); // salary figures need the salary permission as well
    expect(NOTIF_MODULE.draft_bills.salary).toBeUndefined();
  });
});
