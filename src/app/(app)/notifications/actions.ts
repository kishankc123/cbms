"use server";

import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { applyState, countsByGroup, hasCriticalUnseen, loadNotifications, loadStates, NOTIF_MODULE, saveState, sortNotifs, type StateAction } from "@/lib/notifications/notifications";

// A person is shown a kind of notification only if they could open the screen it leads to: View on its module (and, for payroll, seeing salary
// amounts). Nothing is looked up for a kind they may not see, so the bell never reveals a figure the screen behind it would refuse.

/** The bell's contents for the signed-in person: what needs attention, with their own seen and snooze choices applied. */
export async function getNotifications() {
  const session = await requireTenantSession();
  const allowed = (key: string) => {
    const m = NOTIF_MODULE[key];
    return Boolean(m) && can(session, m.module, "view") && (!m.salary || can(session, "payroll", "view_salary"));
  };
  const today = todayIso();
  const [list, states] = await Promise.all([loadNotifications(session.tenantId, today, allowed), loadStates(session.tenantId, session.userId)]);
  const items = sortNotifs(applyState(list, states, today));
  return { items, counts: countsByGroup(items), critical: hasCriticalUnseen(items) };
}
export type NotificationsData = Awaited<ReturnType<typeof getNotifications>>;

/** Marks notifications seen, unseen or snoozed for the signed-in person only. `count` is how many things were behind each when they chose. */
export async function setNotificationState(input: { items: { key: string; count: number }[]; action: StateAction }) {
  const session = await requireTenantSession();
  const allowed = (key: string) => {
    const m = NOTIF_MODULE[key];
    return Boolean(m) && can(session, m.module, "view") && (!m.salary || can(session, "payroll", "view_salary"));
  };
  if (!["seen", "unseen", "snooze1", "snooze7"].includes(input.action)) throw new Error("Choose what to do with the notification");
  const today = todayIso();
  for (const item of input.items.slice(0, 50)) {
    if (!allowed(item.key)) continue; // a kind this person can't see is ignored, never stored
    await saveState(session.tenantId, session.userId, item.key, input.action, item.count, today);
  }
}
