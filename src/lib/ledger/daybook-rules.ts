// The Daybook: one day of the business at a glance, worked out from the ledger lines of that day. Pure, no database, so the screen, the image, the
// spreadsheet and the tests all use the same figures.
//
// Everything starts from the lines posted to cash, bank and wallet accounts (the "money lines"): each one lands in exactly one place, so the parts always
// add up to the whole, and opening + money in - money out + moves between own accounts = closing for every account.

export const NO_MODE = "No mode recorded";
export const ON_CREDIT = "On credit";

export type DayLine = { accountId: string; debit: number; credit: number; modeName: string | null };
export type DayEntry = { id: string; sourceType: string; sourceId: string | null; isReversed: boolean; reversalOfId: string | null; lines: DayLine[] };
export type CashAccount = { id: string; code: string; name: string };

export type ModeAmount = { mode: string; amount: number };
export type DocSection = { total: number; count: number; /** how it was settled on the day, by mode; "On credit" is the part not paid yet */ byMode: ModeAmount[]; returns: number };
export type OtherMovement = { key: string; label: string; in: number; out: number };
export type AccountRow = { accountId: string; code: string; name: string; group: "cash" | "bank"; opening: number; in: number; out: number; transfers: number; closing: number };
export type GroupRow = { group: "cash" | "bank"; label: string; opening: number; in: number; out: number; transfers: number; closing: number };

export type Daybook = {
  day: string;
  sales: DocSection;
  purchases: DocSection;
  expenses: DocSection;
  moneyIn: number;
  moneyOut: number;
  net: number;
  other: OtherMovement[];
  /** Moves between the business's own accounts: neither money in nor out. */
  transfersMoved: number;
  groups: GroupRow[];
  accounts: AccountRow[];
  totals: { opening: number; in: number; out: number; transfers: number; closing: number };
  /** False if an account's closing balance from the ledger differs from opening + movement (should never happen). */
  reconciles: boolean;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const OTHER_LABEL: Record<string, string> = {
  receipt: "Collected from customers",
  payment: "Paid to suppliers and others",
  payroll: "Salaries and payroll",
  asset_purchase: "Assets bought",
  asset_disposal: "Assets sold",
  asset_writeoff: "Assets written off",
  sales_return: "Sales returns refunded",
  purchase_return: "Purchase returns received",
  bank_adjustment: "Bank charges and interest",
  tax_assessment: "Tax charges",
  opening_balance: "Opening balances entered",
  advance_application: "Advances applied",
  stock_adjustment: "Stock adjustments",
  manual: "Manual entries",
  corrections: "Corrections of earlier entries",
};
const OTHER_ORDER = ["receipt", "payment", "payroll", "asset_purchase", "asset_disposal", "asset_writeoff", "sales_return", "purchase_return", "bank_adjustment", "tax_assessment", "advance_application", "stock_adjustment", "manual", "opening_balance", "corrections"];

export function buildDaybook(input: { day: string; entries: DayEntry[]; cashAccounts: CashAccount[]; opening: Record<string, number>; closing: Record<string, number> }): Daybook {
  const cashIds = new Set(input.cashAccounts.map((a) => a.id));
  const onDay = new Set(input.entries.map((e) => e.id));

  // A voided or edited entry and the entry that reversed it cancel when both are on this day. When only one is here (an older correction made on another
  // day) it stays, so opening + movement still equals closing, and its money is shown as a correction.
  const cancelled = new Set<string>();
  for (const e of input.entries) if (e.reversalOfId && onDay.has(e.reversalOfId)) { cancelled.add(e.id); cancelled.add(e.reversalOfId); }
  const live = input.entries.filter((e) => !cancelled.has(e.id));
  const isCorrection = (e: DayEntry) => e.isReversed || e.reversalOfId !== null;
  const economic = live.filter((e) => !isCorrection(e));

  const sum = (e: DayEntry, f: (l: DayLine) => number) => e.lines.reduce((s, l) => s + f(l), 0);
  const docs = (type: string) => economic.filter((e) => e.sourceType === type);
  const idsOf = (list: DayEntry[]) => new Set(list.map((e) => e.sourceId).filter((x): x is string => Boolean(x)));
  const saleEntries = docs("sale");
  const purchaseEntries = docs("purchase");
  const expenseEntries = docs("expense");
  const saleIds = idsOf(saleEntries);
  const purchaseIds = idsOf(purchaseEntries);
  const expenseIds = idsOf(expenseEntries);

  type Bucket = { kind: "sales" | "purchases" | "expenses" } | { kind: "other"; key: string } | { kind: "transfer" };
  const bucketOf = (e: DayEntry): Bucket => {
    if (e.sourceType === "inter_transfer") return { kind: "transfer" };
    if (isCorrection(e)) return { kind: "other", key: "corrections" };
    if (e.sourceType === "sale" || (e.sourceType === "receipt" && e.sourceId && saleIds.has(e.sourceId))) return { kind: "sales" };
    if (e.sourceType === "purchase" || (e.sourceType === "payment" && e.sourceId && purchaseIds.has(e.sourceId))) return { kind: "purchases" };
    if (e.sourceType === "expense" || (e.sourceType === "payment" && e.sourceId && expenseIds.has(e.sourceId))) return { kind: "expenses" };
    return { kind: "other", key: OTHER_LABEL[e.sourceType] ? e.sourceType : "manual" };
  };

  const modes = { sales: new Map<string, number>(), purchases: new Map<string, number>(), expenses: new Map<string, number>() };
  const other = new Map<string, { in: number; out: number }>();
  const acct = new Map<string, { in: number; out: number; transfers: number }>(input.cashAccounts.map((a) => [a.id, { in: 0, out: 0, transfers: 0 }]));
  let moneyIn = 0;
  let moneyOut = 0;
  let transfersMoved = 0;

  for (const e of live) {
    const b = bucketOf(e);
    for (const l of e.lines) {
      if (!cashIds.has(l.accountId)) continue;
      const a = acct.get(l.accountId)!;
      if (b.kind === "transfer") {
        a.transfers += l.debit - l.credit;
        transfersMoved += l.debit;
        continue;
      }
      a.in += l.debit;
      a.out += l.credit;
      moneyIn += l.debit;
      moneyOut += l.credit;
      if (b.kind === "other") {
        const o = other.get(b.key) ?? { in: 0, out: 0 };
        o.in += l.debit;
        o.out += l.credit;
        other.set(b.key, o);
      } else {
        const mode = l.modeName ?? NO_MODE;
        const net = b.kind === "sales" ? l.debit - l.credit : l.credit - l.debit; // money received for sales, money paid for purchases and expenses
        modes[b.kind].set(mode, (modes[b.kind].get(mode) ?? 0) + net);
      }
    }
  }

  const section = (entries: DayEntry[], map: Map<string, number>, returnsOf: number): DocSection => {
    const total = round2(entries.reduce((s, e) => s + sum(e, (l) => l.debit), 0));
    const paid = [...map.entries()].filter(([, v]) => Math.abs(v) > 0.004).map(([mode, amount]) => ({ mode, amount: round2(amount) }));
    paid.sort((a, b) => (a.mode === NO_MODE ? 1 : 0) - (b.mode === NO_MODE ? 1 : 0) || b.amount - a.amount);
    const credit = round2(Math.max(0, total - paid.reduce((s, p) => s + p.amount, 0)));
    return { total, count: entries.length, byMode: credit > 0.004 ? [...paid, { mode: ON_CREDIT, amount: credit }] : paid, returns: round2(returnsOf) };
  };
  const returnsOf = (type: string) => economic.filter((e) => e.sourceType === type).reduce((s, e) => s + sum(e, (l) => l.debit), 0);

  const accounts: AccountRow[] = input.cashAccounts
    .map((a): AccountRow => {
      const m = acct.get(a.id)!;
      const opening = round2(input.opening[a.id] ?? 0);
      return { accountId: a.id, code: a.code, name: a.name, group: a.code.startsWith("1000") ? "cash" : "bank", opening, in: round2(m.in), out: round2(m.out), transfers: round2(m.transfers), closing: round2(opening + m.in - m.out + m.transfers) };
    })
    .filter((a) => [a.opening, a.in, a.out, a.transfers, a.closing].some((v) => Math.abs(v) > 0.004))
    .sort((a, b) => a.code.localeCompare(b.code));
  const reconciles = input.cashAccounts.every((a) => Math.abs(round2((input.opening[a.id] ?? 0) + (acct.get(a.id)!.in - acct.get(a.id)!.out + acct.get(a.id)!.transfers)) - round2(input.closing[a.id] ?? 0)) < 0.011);

  const groupRow = (group: "cash" | "bank", label: string): GroupRow => {
    const mine = accounts.filter((a) => a.group === group);
    const s = (f: (a: AccountRow) => number) => round2(mine.reduce((t, a) => t + f(a), 0));
    return { group, label, opening: s((a) => a.opening), in: s((a) => a.in), out: s((a) => a.out), transfers: s((a) => a.transfers), closing: s((a) => a.closing) };
  };
  const groups = [groupRow("cash", "Cash"), groupRow("bank", "Bank and wallets")].filter((g) => accounts.some((a) => a.group === g.group));
  const t = (f: (g: GroupRow) => number) => round2(groups.reduce((s, g) => s + f(g), 0));

  return {
    day: input.day,
    sales: section(saleEntries, modes.sales, returnsOf("sales_return")),
    purchases: section(purchaseEntries, modes.purchases, returnsOf("purchase_return")),
    expenses: section(expenseEntries, modes.expenses, 0),
    moneyIn: round2(moneyIn),
    moneyOut: round2(moneyOut),
    net: round2(moneyIn - moneyOut),
    other: OTHER_ORDER.filter((k) => other.has(k)).map((k) => ({ key: k, label: OTHER_LABEL[k], in: round2(other.get(k)!.in), out: round2(other.get(k)!.out) })).filter((o) => o.in > 0.004 || o.out > 0.004),
    transfersMoved: round2(transfersMoved),
    groups,
    accounts,
    totals: { opening: t((g) => g.opening), in: t((g) => g.in), out: t((g) => g.out), transfers: t((g) => g.transfers), closing: t((g) => g.closing) },
    reconciles,
  };
}
