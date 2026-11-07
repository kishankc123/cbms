import { addDays } from "@/lib/calendar";
import { DUE_SOON_DAYS, effectiveStatus, type EffectiveStatus, type ObligationStatus } from "@/lib/compliance/engine/status";

// The Compliance tab of the dashboard, worked out from the organization's compliance items. Pure: no database, so the figures are easy to test.
// The open counts and the deadline list are "what is open now" and ignore the dashboard's period; only "Filed in this period" uses it.

export type ObligationRow = {
  id: string;
  name: string;
  categoryKey: string;
  periodLabel: string;
  dueDate: string;
  status: ObligationStatus;
  amountDue: number | null;
  filingDate: string | null;
  paymentDate: string | null;
  filedBeforeSystem: boolean;
};

export type Area = "tax" | "statutory";
/** Tax is tax; everything else a company has to do by law (company filings, ownership records, permits kept as statutory) is statutory. */
export const areaOf = (categoryKey: string): Area => (categoryKey === "tax" ? "tax" : "statutory");
export const AREA_LABEL: Record<Area, string> = { tax: "Tax", statutory: "Statutory" };
export const AREA_HREF: Record<Area, string> = { tax: "/compliance/tax", statutory: "/compliance/statutory" };

export type DeadlineRow = { id: string; name: string; area: Area; period: string; dueDate: string; status: EffectiveStatus; amount: number | null; href: string };

export type ComplianceTab = {
  counts: { overdue: number; dueSoon: number; coming: number; filedInPeriod: number };
  deadlines: DeadlineRow[];
  /** Open items beyond the ones listed. */
  moreCount: number;
  areas: { key: Area; label: string; href: string; pending: number; overdue: number }[];
};

const isOpen = (s: ObligationStatus) => s !== "filed" && s !== "paid" && s !== "not_applicable";
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * overdue: past its date and still open. dueSoon: falls due in the next 7 days. coming: after that, within the next 30 days.
 * filedInPeriod: filed or paid (by the organization, not before it began using the system) on a date inside the dashboard's period.
 * The list holds everything overdue plus what falls due in the next 30 days, soonest first, up to `limit`.
 */
export function buildComplianceTab(rows: ObligationRow[], today: string, range: { from: string; to: string }, limit = 10): ComplianceTab {
  const open = rows.filter((r) => isOpen(r.status));
  const soonEnd = addDays(today, DUE_SOON_DAYS);
  const comingEnd = addDays(today, 30);
  const overdue = open.filter((r) => r.dueDate < today);
  const dueSoon = open.filter((r) => r.dueDate >= today && r.dueDate <= soonEnd);
  const coming = open.filter((r) => r.dueDate > soonEnd && r.dueDate <= comingEnd);
  const filedInPeriod = rows.filter((r) => {
    if ((r.status !== "filed" && r.status !== "paid") || r.filedBeforeSystem) return false;
    const done = r.filingDate ?? r.paymentDate;
    return done !== null && done >= range.from && done <= range.to;
  });

  const listed = open.filter((r) => r.dueDate <= comingEnd).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  const deadlines = listed.slice(0, limit).map((r): DeadlineRow => {
    const area = areaOf(r.categoryKey);
    return { id: r.id, name: r.name, area, period: r.periodLabel, dueDate: r.dueDate, status: effectiveStatus({ status: r.status, dueDate: r.dueDate }, today), amount: r.amountDue === null ? null : round2(r.amountDue), href: AREA_HREF[area] };
  });

  const areas = (["tax", "statutory"] as Area[]).map((key) => {
    const mine = open.filter((r) => areaOf(r.categoryKey) === key);
    return { key, label: AREA_LABEL[key], href: AREA_HREF[key], pending: mine.length, overdue: mine.filter((r) => r.dueDate < today).length };
  });

  return { counts: { overdue: overdue.length, dueSoon: dueSoon.length, coming: coming.length, filedInPeriod: filedInPeriod.length }, deadlines, moreCount: Math.max(0, listed.length - limit), areas };
}
