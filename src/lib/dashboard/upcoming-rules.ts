// Upcoming money: what customers still owe us and what we still owe, grouped by how near the due date is. Pure rules, no database.

export const SOON_DAYS = 7;

export type DueBucket = "overdue" | "today" | "soon" | "scheduled";
export const BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "soon", label: `Due in the next ${SOON_DAYS} days` },
  { key: "scheduled", label: "Scheduled later" },
];

export type UpcomingKind = "receivable" | "bill" | "expense";

export type UpcomingItem = {
  kind: UpcomingKind;
  id: string;
  /** Customer, supplier or payee. */
  party: string;
  partyId: string | null;
  reference: string;
  /** The date shown: the due date, or the document date when no due date was set. */
  dueDate: string;
  hasDueDate: boolean;
  outstanding: number;
};

const DAY = 86_400_000;
export const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / DAY);

/** Days from today to the due date: negative once it is past. */
export const daysUntil = (dueDate: string, today: string) => daysBetween(today, dueDate);

export function bucketOf(dueDate: string, today: string): DueBucket {
  const d = daysUntil(dueDate, today);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= SOON_DAYS) return "soon";
  return "scheduled";
}

export function isBucket(v: unknown): v is DueBucket {
  return v === "overdue" || v === "today" || v === "soon" || v === "scheduled";
}

/** The last day counted as "soon", for the database to compare against. */
export function soonLimit(today: string): string {
  return new Date(Date.parse(today + "T00:00:00Z") + SOON_DAYS * DAY).toISOString().slice(0, 10);
}

export type BucketTotals = Record<DueBucket, { count: number; amount: number }>;

export const emptyTotals = (): BucketTotals => ({ overdue: { count: 0, amount: 0 }, today: { count: 0, amount: 0 }, soon: { count: 0, amount: 0 }, scheduled: { count: 0, amount: 0 } });

const round2 = (n: number) => Math.round(n * 100) / 100;

export function totalOf(t: BucketTotals, buckets: DueBucket[] = ["overdue", "today", "soon", "scheduled"]) {
  return buckets.reduce((acc, b) => ({ count: acc.count + t[b].count, amount: round2(acc.amount + t[b].amount) }), { count: 0, amount: 0 });
}

/** Plain-words timing for a row: "3 days overdue", "Due today", "In 5 days". */
export function dueLabel(dueDate: string, today: string): string {
  const d = daysUntil(dueDate, today);
  if (d === 0) return "Due today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "1 day overdue";
  return d < 0 ? `${-d} days overdue` : `In ${d} days`;
}

export type UpcomingParty = {
  key: string;
  /** Whose ledger to open: a customer, a supplier, or only a name written on an expense (no ledger). */
  kind: "customer" | "supplier" | "payee";
  partyId: string | null;
  name: string;
  count: number;
  outstanding: number;
  /** The nearest (or most overdue) due date among this party's open documents. */
  earliestDue: string;
};
