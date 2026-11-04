// How money moved, worked out from the lines posted to cash, bank and wallet accounts. Pure: no database, so the rules can be tested
// on their own. Every cash line lands in exactly one category, so the categories add up to the ledger's own movement of cash.
//
// Moving money between the business's own accounts (Inter-Transfers) is neither money in nor money out, and the opening balances
// entered when the books were started are not either; both are shown beside the totals so the figures still reconcile.

import { addDays, formatDate, monthNames, ymdOf, type CalendarSystem } from "@/lib/calendar";

export type Activity = "operating" | "investing" | "financing" | "other";
export type FlowSide = "in" | "out";

export type FlowCategory = { key: string; label: string; activity: Activity; side: FlowSide };

// The categories, in the order they are shown. `side` is the direction a category naturally moves money; a line against it (the
// reversal of a receipt, say) reduces the category instead of appearing on the other side.
export const CATEGORIES: FlowCategory[] = [
  { key: "customer_collections", label: "Customer collections and cash sales", activity: "operating", side: "in" },
  { key: "supplier_refunds", label: "Refunds from suppliers", activity: "operating", side: "in" },
  { key: "other_receipts", label: "Other receipts", activity: "operating", side: "in" },
  { key: "asset_sales", label: "Asset sale proceeds", activity: "investing", side: "in" },
  { key: "loans_received", label: "Loans received", activity: "financing", side: "in" },
  { key: "capital_introduced", label: "Capital introduced", activity: "financing", side: "in" },
  { key: "adjustments_in", label: "Manual and bank adjustments in", activity: "other", side: "in" },

  { key: "supplier_payments", label: "Supplier payments and advances", activity: "operating", side: "out" },
  { key: "expense_payments", label: "Expenses paid (rent, utilities, other)", activity: "operating", side: "out" },
  { key: "payroll", label: "Salaries and staff advances", activity: "operating", side: "out" },
  { key: "tax_payments", label: "Tax payments", activity: "operating", side: "out" },
  { key: "customer_refunds", label: "Refunds to customers", activity: "operating", side: "out" },
  { key: "other_payments", label: "Other payments", activity: "operating", side: "out" },
  { key: "asset_purchases", label: "Asset purchases", activity: "investing", side: "out" },
  { key: "loan_repayments", label: "Loan repayments", activity: "financing", side: "out" },
  { key: "owner_drawings", label: "Owner withdrawals and distributions", activity: "financing", side: "out" },
  { key: "adjustments_out", label: "Manual and bank adjustments out", activity: "other", side: "out" },
];
const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** Which category a cash line belongs to, or "transfer" / "opening" for lines that are neither money in nor money out. */
export function classify(sourceType: string, paymentType: string | null, isDebit: boolean): string {
  if (sourceType === "inter_transfer") return "transfer";
  if (sourceType === "opening_balance") return "opening";

  if (paymentType) {
    switch (paymentType) {
      case "customer_payment":
      case "customer_advance":
        return "customer_collections";
      case "refund_received":
        return "supplier_refunds";
      case "other_receipt":
        return "other_receipts";
      case "loan_received":
        return "loans_received";
      case "capital_introduced":
        return "capital_introduced";
      case "supplier_payment":
      case "supplier_advance":
        return "supplier_payments";
      case "expense_payment":
        return "expense_payments";
      case "salary_payment":
      case "staff_advance":
        return "payroll";
      case "tax_payment":
        return "tax_payments";
      case "customer_refund":
        return "customer_refunds";
      case "loan_repayment":
        return "loan_repayments";
      case "owner_withdrawal":
        return "owner_drawings";
      case "bank_transfer":
      case "cash_withdrawal":
        return "transfer"; // older ways of moving money between the business's own accounts
      default:
        return "other_payments";
    }
  }

  switch (sourceType) {
    case "sale":
    case "receipt":
      return "customer_collections";
    case "purchase":
      return "supplier_payments";
    case "payment":
    case "expense":
      return "expense_payments";
    case "sales_return":
      return "customer_refunds";
    case "purchase_return":
      return "supplier_refunds";
    case "asset_purchase":
      return "asset_purchases";
    case "asset_disposal":
    case "asset_writeoff":
      return "asset_sales";
    case "payroll":
      return "payroll";
    case "tax_assessment":
      return "tax_payments";
    default:
      // Manual journals, bank adjustments and anything else: shown on the side the cash moved.
      return isDebit ? "adjustments_in" : "adjustments_out";
  }
}

/** One group of lines as the database returns it: a day, what posted it, and what it moved on the cash accounts. */
export type CashLineGroup = { day: string; sourceType: string; paymentType: string | null; debit: number; credit: number };

export type CategoryTotal = FlowCategory & { amount: number };
export type DayFlow = { day: string; moneyIn: number; moneyOut: number };

export type CashFlowResult = {
  from: string;
  to: string;
  openingCash: number;
  closingCash: number;
  moneyIn: number;
  moneyOut: number;
  netMovement: number;
  categories: CategoryTotal[];
  activities: { activity: Activity; label: string; moneyIn: number; moneyOut: number; net: number }[];
  daily: DayFlow[];
  /** Moves that are neither money in nor out, so the check below still adds up. */
  transfersNet: number;
  openingEntriesNet: number;
  /** Opening cash + net movement + the two lines above, against the ledger's closing cash. Should be 0.00. */
  difference: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const ACTIVITY_LABEL: Record<Activity, string> = { operating: "Operating", investing: "Investing", financing: "Financing", other: "Adjustments" };

export function buildCashFlow(groups: CashLineGroup[], openingCash: number, closingCash: number, range: { from: string; to: string }): CashFlowResult {
  const totals = new Map<string, number>(); // category -> signed net on its natural side
  const byDay = new Map<string, { moneyIn: number; moneyOut: number }>();
  let transfersNet = 0;
  let openingEntriesNet = 0;

  for (const g of groups) {
    const net = g.debit - g.credit; // positive: money into the cash accounts
    const key = classify(g.sourceType, g.paymentType, net >= 0);
    if (key === "transfer") {
      transfersNet += net;
      continue;
    }
    if (key === "opening") {
      openingEntriesNet += net;
      continue;
    }
    const category = BY_KEY.get(key)!;
    const natural = category.side === "in" ? net : -net;
    totals.set(key, (totals.get(key) ?? 0) + natural);
    const day = byDay.get(g.day) ?? { moneyIn: 0, moneyOut: 0 };
    if (category.side === "in") day.moneyIn += natural;
    else day.moneyOut += natural;
    byDay.set(g.day, day);
  }

  const categories = CATEGORIES.map((c) => ({ ...c, amount: round2(totals.get(c.key) ?? 0) })).filter((c) => c.amount !== 0);
  const moneyIn = round2(categories.filter((c) => c.side === "in").reduce((s, c) => s + c.amount, 0));
  const moneyOut = round2(categories.filter((c) => c.side === "out").reduce((s, c) => s + c.amount, 0));
  const netMovement = round2(moneyIn - moneyOut);

  const activities = (["operating", "investing", "financing", "other"] as Activity[])
    .map((activity) => {
      const rows = categories.filter((c) => c.activity === activity);
      const i = round2(rows.filter((c) => c.side === "in").reduce((s, c) => s + c.amount, 0));
      const o = round2(rows.filter((c) => c.side === "out").reduce((s, c) => s + c.amount, 0));
      return { activity, label: ACTIVITY_LABEL[activity], moneyIn: i, moneyOut: o, net: round2(i - o) };
    })
    .filter((a) => a.moneyIn !== 0 || a.moneyOut !== 0);

  const daily = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, v]) => ({ day, moneyIn: round2(v.moneyIn), moneyOut: round2(v.moneyOut) }));
  const difference = round2(closingCash - (openingCash + netMovement + transfersNet + openingEntriesNet));

  return { from: range.from, to: range.to, openingCash: round2(openingCash), closingCash: round2(closingCash), moneyIn, moneyOut, netMovement, categories, activities, daily, transfersNet: round2(transfersNet), openingEntriesNet: round2(openingEntriesNet), difference };
}

// ----------------------------------------------------------------------- buckets

export type Grain = "day" | "week" | "month";
export type Bucket = { key: string; label: string; start: string; moneyIn: number; moneyOut: number };

/** A sensible grain for a period: days for a month or less, weeks up to about four months, months beyond. */
export function defaultGrain(from: string, to: string): Grain {
  const days = Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86_400_000) + 1;
  return days <= 35 ? "day" : days <= 130 ? "week" : "month";
}

/** The bucket a day falls in. Weeks run Sunday to Saturday; months follow the organization's calendar (BS months for a BS organization). */
export function bucketOf(day: string, grain: Grain, calendar: CalendarSystem): { key: string; label: string; start: string } {
  if (grain === "day") {
    const ymd = ymdOf(calendar, day);
    return { key: day, label: ymd ? String(ymd.day) : day.slice(8), start: day };
  }
  if (grain === "week") {
    const dow = new Date(day + "T00:00:00Z").getUTCDay(); // 0 = Sunday
    const start = addDays(day, -dow);
    return { key: start, label: formatDate(start, calendar, "short"), start };
  }
  const ymd = ymdOf(calendar, day);
  if (!ymd) return { key: day.slice(0, 7), label: day.slice(0, 7), start: day.slice(0, 7) + "-01" };
  const start = addDays(day, -(ymd.day - 1));
  return { key: `${ymd.year}-${String(ymd.month).padStart(2, "0")}`, label: `${monthNames(calendar)[ymd.month - 1].slice(0, 3)} ${ymd.year}`, start };
}

/** Every bucket in the period, empty ones included, so the chart has no gaps. */
export function toBuckets(daily: DayFlow[], range: { from: string; to: string }, grain: Grain, calendar: CalendarSystem): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const b = bucketOf(d, grain, calendar);
    if (!buckets.has(b.key)) buckets.set(b.key, { ...b, moneyIn: 0, moneyOut: 0 });
  }
  for (const row of daily) {
    const b = buckets.get(bucketOf(row.day, grain, calendar).key);
    if (!b) continue;
    b.moneyIn = round2(b.moneyIn + row.moneyIn);
    b.moneyOut = round2(b.moneyOut + row.moneyOut);
  }
  return [...buckets.values()];
}
