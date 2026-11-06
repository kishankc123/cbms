// What the notification bell shows and how a person's "seen" and "snooze" choices apply to it (no database, safe for the browser).
// Notifications are worked out live from the books each time, so they never go stale; the only thing stored is each person's own choice about each KIND of
// notification. A seen or snoozed notification comes back on its own when the number of things behind it grows.

export type NotifGroup = "verify" | "due" | "alert";
export type NotifSeverity = "critical" | "action" | "info";

export type Notif = {
  /** One per kind of notification (not per item), so a person's choice about it is simple to keep. */
  key: string;
  group: NotifGroup;
  severity: NotifSeverity;
  title: string;
  detail: string;
  /** Where Open goes: the screen that fixes it. */
  href: string;
  /** How many things are behind it. The choice a person made is remembered against this, so it comes back if it grows. */
  count: number;
  amount: number | null;
  /** How long the oldest of them has been waiting, in days, when that is known. */
  sinceDays: number | null;
};

/** `snoozedUntil` is the day a snoozed notification comes back (snoozed on the 6th for one day: back on the 7th). */
export type NotifState = { key: string; state: "seen" | "snoozed"; snoozedUntil: string | null; countAt: number | null };
export type NotifView = Notif & { seen: boolean };

/** What a person can do with a notification: mark it seen or unseen, or snooze it for a day or a week. */
export type StateAction = "seen" | "unseen" | "snooze1" | "snooze7";

/** The module whose View a person needs to be shown each kind of notification. "payroll" kinds also need to see salary amounts. */
export const NOTIF_MODULE: Record<string, { module: string; salary?: boolean }> = {
  trial_balance: { module: "chart_of_accounts" },
  draft_invoices: { module: "sales" },
  draft_bills: { module: "purchases" },
  details_pending: { module: "purchases" },
  negative_stock: { module: "inventory" },
  overdue_receivables: { module: "sales" },
  cheques_due: { module: "payments" },
  received_cheques_ready: { module: "payments" },
  bank_unmatched: { module: "bank_reconciliation" },
  payroll_runs: { module: "payroll", salary: true },
  contributions_owed: { module: "payroll", salary: true },
  compliance_overdue: { module: "compliance" },
  compliance_due: { module: "compliance" },
  tax_depreciation_review: { module: "assets" },
};
export const NOTIF_KEYS = Object.keys(NOTIF_MODULE);

export const GROUP_LABEL: Record<NotifGroup, string> = { verify: "Verification pending", due: "Due soon", alert: "Alerts" };

const RANK: Record<NotifSeverity, number> = { critical: 0, action: 1, info: 2 };

/**
 * Applies one person's choices. Snoozed and not yet due again: left out. Seen: shown, marked seen. Either one is undone when more things are behind
 * the notification than when the choice was made (a new problem shouldn't hide behind an old "seen"), and a snooze ends on its date.
 */
export function applyState(list: Notif[], states: NotifState[], today: string): NotifView[] {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const out: NotifView[] = [];
  for (const n of list) {
    const s = byKey.get(n.key);
    if (!s) {
      out.push({ ...n, seen: false });
      continue;
    }
    const grew = s.countAt !== null && n.count > s.countAt;
    if (s.state === "snoozed") {
      const stillSnoozed = s.snoozedUntil !== null && s.snoozedUntil > today && !grew;
      if (!stillSnoozed) out.push({ ...n, seen: false });
    } else {
      out.push({ ...n, seen: !grew });
    }
  }
  return out;
}

/** Critical first, then needs action, then information; within each, the longest waiting first. */
export function sortNotifs(list: NotifView[]): NotifView[] {
  return [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.sinceDays ?? -1) - (a.sinceDays ?? -1) || a.title.localeCompare(b.title));
}

export const unseenCount = (list: NotifView[]) => list.filter((n) => !n.seen).length;

export function countsByGroup(list: NotifView[]): Record<NotifGroup | "all", number> {
  const unseen = list.filter((n) => !n.seen);
  return { all: unseen.length, verify: unseen.filter((n) => n.group === "verify").length, due: unseen.filter((n) => n.group === "due").length, alert: unseen.filter((n) => n.group === "alert").length };
}

/** True when the badge should be red: something critical has not been seen. */
export const hasCriticalUnseen = (list: NotifView[]) => list.some((n) => !n.seen && n.severity === "critical");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export { plural };
