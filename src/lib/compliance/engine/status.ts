import type { IsoDate } from "@/lib/calendar";
import { addDays } from "@/lib/calendar";

export type ObligationStatus = "pending" | "in_progress" | "filed" | "paid" | "partially_paid" | "not_applicable";
export type EffectiveStatus = ObligationStatus | "overdue";

/** Done = nothing further is expected of the organization. */
export const DONE_STATUSES: ObligationStatus[] = ["filed", "paid", "not_applicable"];

/** How many days ahead counts as "due soon" on the dashboard. */
export const DUE_SOON_DAYS = 7;

/**
 * "Overdue" is derived, never stored, so it cannot go stale overnight: an item
 * is overdue when its due date has passed and it is not done. Partially paid
 * items stay open, so they can become overdue too.
 */
export function effectiveStatus(item: { status: ObligationStatus; dueDate: IsoDate }, today: IsoDate): EffectiveStatus {
  if (DONE_STATUSES.includes(item.status)) return item.status;
  return item.dueDate < today ? "overdue" : item.status;
}

export type ComplianceSummary = { dueSoon: number; overdue: number; completed: number; upcoming: number };

/** Summary card numbers. Not-applicable items are excluded from every count. */
export function summarize(items: { status: ObligationStatus; dueDate: IsoDate }[], today: IsoDate): ComplianceSummary {
  const soonEnd = addDays(today, DUE_SOON_DAYS);
  const s: ComplianceSummary = { dueSoon: 0, overdue: 0, completed: 0, upcoming: 0 };
  for (const i of items) {
    if (i.status === "not_applicable") continue;
    if (i.status === "filed" || i.status === "paid") s.completed++;
    else if (i.dueDate < today) s.overdue++;
    else if (i.dueDate <= soonEnd) s.dueSoon++;
    else s.upcoming++;
  }
  return s;
}

/** Old calendar-item statuses -> the new set. "overdue" was stored before; now it is derived, so it maps to pending. */
export function mapLegacyStatus(legacy: string, hasPaymentDate: boolean): ObligationStatus {
  switch (legacy) {
    case "prepared":
    case "under_review":
      return "in_progress";
    case "submitted":
      return "filed";
    case "paid":
      return "paid";
    case "completed":
      return hasPaymentDate ? "paid" : "filed";
    default:
      return "pending"; // upcoming, due, overdue
  }
}
