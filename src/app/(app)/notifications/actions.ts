"use server";

import { requireTenantSession, requireUserSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { verificationEmailProblem } from "@/lib/email-log";
import { applyState, countsByGroup, hasCriticalUnseen, loadNotifications, loadStates, NOTIF_MODULE, PERSONAL_KEYS, saveState, sortNotifs, verifyEmailNotif, type StateAction } from "@/lib/notifications/notifications";

// A person is shown a kind of notification only if they could open the screen it leads to: View on its module (and, for payroll, seeing salary
// amounts). Nothing is looked up for a kind they may not see, so the bell never reveals a figure the screen behind it would refuse.
// A few kinds belong to the person themselves (their own email address) and need no module permission.

/** The bell's contents for the signed-in person: what needs attention, with their own seen and snooze choices applied. */
export async function getNotifications() {
  const session = await requireTenantSession();
  const allowed = (key: string) => {
    const m = NOTIF_MODULE[key];
    return Boolean(m) && can(session, m.module, "view") && (!m.salary || can(session, "payroll", "view_salary"));
  };
  const today = todayIso();
  const [list, states, user] = await Promise.all([loadNotifications(session.tenantId, today, allowed), loadStates(session.tenantId, session.userId), requireUserSession()]);
  // Not verified yet: shown here instead of as a banner across every page.
  if (!user.emailVerifiedAt) list.push(verifyEmailNotif(await verificationEmailProblem(user.email)));
  const items = sortNotifs(applyState(list, states, today));
  return { items, counts: countsByGroup(items), critical: hasCriticalUnseen(items) };
}
export type NotificationsData = Awaited<ReturnType<typeof getNotifications>>;

/** Marks notifications seen, unseen or snoozed for the signed-in person only. `count` is how many things were behind each when they chose. */
export async function setNotificationState(input: { items: { key: string; count: number }[]; action: StateAction }) {
  const session = await requireTenantSession();
  const allowed = (key: string) => {
    if ((PERSONAL_KEYS as readonly string[]).includes(key)) return true;
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
