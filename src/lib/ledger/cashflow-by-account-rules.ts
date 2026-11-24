// Cash flow by account: one column for each cash, bank and wallet account, and rows for what the money was for. Pure (no database) so the rules can be tested
// on their own.
//
// For every entry that touched a cash account, the cash that moved is spread over the other lines of the entry that sit on the opposite side (an
// expense that was paid, the customer who paid, the supplier who was paid), and each of those lines is put on a row by what its account is. The rows are
// not typed in: they follow the Chart of Accounts, so a new expense account shows up by itself.
//
// Money in is positive and money out negative. Moves between the business's own accounts are shown as Inter-transfer rows (they cancel in the Total column),
// and the opening balances entered when the books were started are part of the opening line, not money in.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type FlowAccount = { id: string; code: string; name: string; category: string; subCategory: string | null; parentId: string | null };
export type FlowEntryLine = { accountId: string; debit: number; credit: number };
export type FlowEntry = {
  id: string;
  sourceType: string;
  /** The kind of payment that posted the entry, if a payment did. */
  paymentType: string | null;
  /** "embedded": the payment was taken together with an invoice (a sale paid on the spot). */
  origin: string | null;
  /** For a payment taken with its invoice: the revenue accounts of that invoice, so the sale lands on the right Sales rows. */
  revenue: { accountId: string; weight: number }[];
  lines: FlowEntryLine[];
};
export type FlowCashAccount = { id: string; name: string; code: string; opening: number; ledgerClosing: number };

export type FlowLine = { key: string; label: string; /** The account behind the row, when it is just one. */ accountId: string | null; cells: number[]; total: number; children: FlowLine[] };
export type FlowSection = { key: string; title: string; lines: FlowLine[]; cells: number[]; total: number };
export type FlowSideTotals = { sections: FlowSection[]; cells: number[]; total: number };
export type CashFlowByAccount = {
  columns: { accountId: string; name: string; code: string }[];
  opening: number[];
  moneyIn: FlowSideTotals;
  moneyOut: FlowSideTotals;
  closing: number[];
  /** What the ledger holds at the end, less opening plus everything that moved. All zeros when the report agrees with the books. */
  differences: number[];
  balanced: boolean;
  /** Whether any inter-transfer rows are shown (so the page can say they cancel in the total). */
  hasTransfers: boolean;
};

const SALARY_PAYMENTS = new Set(["salary_payment", "retirement_payment", "staff_advance"]);
const SALARY_RENT_CODES = new Set(["5100", "5200"]);

type SectionKey = "sales" | "receivables" | "other_in" | "purchases" | "operating" | "salary_rent" | "payables" | "other_out";
const SECTION_TITLE: Record<SectionKey, string> = {
  sales: "Sales",
  receivables: "Receivables",
  other_in: "Other",
  purchases: "Purchases",
  operating: "Operational expenses",
  salary_rent: "Salary and rent",
  payables: "Payables",
  other_out: "Other",
};
const IN_ORDER: SectionKey[] = ["sales", "receivables", "other_in"];
const OUT_ORDER: SectionKey[] = ["purchases", "operating", "salary_rent", "payables", "other_out"];

type Place = { section: SectionKey; key: string; label: string; accountId: string | null; /** When one line spreads over several rows (a sale over its revenue accounts): this row's weight. */ share?: number; /** A row under the row above (one customer, one supplier). */ child?: { key: string; label: string; accountId: string | null } };

function ancestors(infos: Map<string, FlowAccount>, a: FlowAccount): FlowAccount[] {
  const path = [a];
  for (let cur = a; cur.parentId && path.length < 12; ) {
    const up = infos.get(cur.parentId);
    if (!up) break;
    path.push(up);
    cur = up;
  }
  return path;
}
const underCode = (infos: Map<string, FlowAccount>, a: FlowAccount, code: string) => ancestors(infos, a).some((x) => x.code === code);

/** Where one line of an entry goes: which section and row, for money that moved `side`. */
function place(counter: FlowAccount | undefined, side: "in" | "out", entry: FlowEntry, infos: Map<string, FlowAccount>, cashIds: Set<string>): Place[] {
  const other = (key: string, label: string, accountId: string | null = null): Place[] => [{ section: side === "in" ? "other_in" : "other_out", key, label, accountId }];
  if (!counter) return other("unclassified", "Other");
  if (cashIds.has(counter.id)) return other(`transfer-${side}`, side === "in" ? "Inter-transfer in" : "Inter-transfer out");
  if (counter.code === "5930") return other(`short-excess-${side}`, side === "in" ? "Cash over (counter closing)" : "Cash short (counter closing)", counter.id);
  if (entry.paymentType === "customer_refund" && side === "out") return other("customer-refunds", "Refunds to customers");
  if (entry.paymentType === "refund_received" && side === "in") return other("supplier-refunds", "Refunds from suppliers");
  if (side === "out" && entry.paymentType && SALARY_PAYMENTS.has(entry.paymentType)) return [{ section: "salary_rent", key: "salaries", label: "Salaries and staff advances", accountId: null }];

  if (underCode(infos, counter, "1100")) {
    if (side === "out") return other("customer-refunds", "Refunds to customers");
    if (entry.origin === "embedded") {
      const weights = entry.revenue.filter((r) => r.weight > 0);
      if (weights.length > 0) {
        return weights.map((r) => {
          const acct = infos.get(r.accountId);
          return { section: "sales" as const, key: r.accountId, label: acct?.name ?? "Sales", accountId: r.accountId, share: r.weight };
        });
      }
      return [{ section: "sales", key: "sales-other", label: "Sales", accountId: null }];
    }
    return [{ section: "receivables", key: "payment-received", label: "Payment received", accountId: null, child: { key: counter.id, label: counter.name, accountId: counter.id } }];
  }
  if (underCode(infos, counter, "2000")) {
    if (side === "in") return other("supplier-refunds", "Refunds from suppliers");
    return [{ section: "payables", key: "paid-to-suppliers", label: "Paid to suppliers", accountId: null, child: { key: counter.id, label: counter.name, accountId: counter.id } }];
  }
  if (counter.category === "income") {
    return side === "in" ? [{ section: "sales", key: counter.id, label: counter.name, accountId: counter.id }] : other("sales-refunded", "Sales returned and refunded");
  }
  if (underCode(infos, counter, "1200") || underCode(infos, counter, "1210")) {
    return side === "out" ? [{ section: "purchases", key: "stock-purchases", label: "Stock purchases", accountId: null }] : other("purchase-returns", "Purchase returns");
  }
  if (counter.category === "expense") {
    if (side === "in") return other(counter.id, counter.name, counter.id);
    const chain = ancestors(infos, counter);
    if (counter.subCategory === "Cost of goods sold" || chain.some((x) => x.code === "5050" || x.subCategory === "Cost of goods sold")) {
      return [{ section: "purchases", key: counter.id, label: counter.name, accountId: counter.id }];
    }
    if (chain.some((x) => SALARY_RENT_CODES.has(x.code))) return [{ section: "salary_rent", key: counter.id, label: counter.name, accountId: counter.id }];
    return [{ section: "operating", key: counter.id, label: counter.name, accountId: counter.id }];
  }
  return other(counter.id, counter.name, counter.id);
}

type Row = { label: string; accountId: string | null; cells: number[]; children: Map<string, { label: string; accountId: string | null; cells: number[] }> };

export function buildCashFlowByAccount(entries: FlowEntry[], cash: FlowCashAccount[], infos: Map<string, FlowAccount>, opts: { showEmptyAccounts?: boolean } = {}): CashFlowByAccount {
  const n = cash.length;
  const col = new Map(cash.map((c, i) => [c.id, i]));
  const cashIds = new Set(cash.map((c) => c.id));
  const opening = cash.map((c) => c.opening);
  const rawNet = cash.map(() => 0);
  const rows = new Map<SectionKey, Map<string, Row>>();
  let hasTransfers = false;

  const add = (p: Place, share: number, ci: number, amount: number) => {
    const bySection = rows.get(p.section) ?? new Map<string, Row>();
    rows.set(p.section, bySection);
    const row = bySection.get(p.key) ?? { label: p.label, accountId: p.accountId, cells: new Array(n).fill(0), children: new Map() };
    bySection.set(p.key, row);
    const part = amount * share;
    row.cells[ci] += part;
    if (p.child) {
      const kid = row.children.get(p.child.key) ?? { label: p.child.label, accountId: p.child.accountId, cells: new Array(n).fill(0) };
      row.children.set(p.child.key, kid);
      kid.cells[ci] += part;
    }
    if (p.key.startsWith("transfer-")) hasTransfers = true;
  };

  for (const e of entries) {
    const cashLines = e.lines.filter((l) => cashIds.has(l.accountId));
    const others = e.lines.filter((l) => !cashIds.has(l.accountId));
    for (const c of cashLines) {
      const net = round2(c.debit - c.credit);
      if (net === 0) continue;
      const ci = col.get(c.accountId)!;
      if (e.sourceType === "opening_balance") {
        opening[ci] += net;
        continue;
      }
      rawNet[ci] += net;
      const side: "in" | "out" = net > 0 ? "in" : "out";
      const amount = net; // signed: in positive, out negative
      // The lines on the other side of the entry take the cash that moved, in proportion to their own amounts.
      let counters = others.filter((o) => (side === "in" ? o.credit - o.debit > 0 : o.debit - o.credit > 0)).map((o) => ({ accountId: o.accountId, weight: Math.abs(o.debit - o.credit) }));
      if (counters.length === 0) {
        counters = cashLines.filter((o) => o !== c && (side === "in" ? o.credit - o.debit > 0 : o.debit - o.credit > 0)).map((o) => ({ accountId: o.accountId, weight: Math.abs(o.debit - o.credit) }));
      }
      if (counters.length === 0) counters = others.map((o) => ({ accountId: o.accountId, weight: Math.abs(o.debit - o.credit) })).filter((o) => o.weight > 0);
      if (counters.length === 0) {
        add(place(undefined, side, e, infos, cashIds)[0], 1, ci, amount);
        continue;
      }
      const total = counters.reduce((s, x) => s + x.weight, 0);
      for (const k of counters) {
        const places = place(infos.get(k.accountId), side, e, infos, cashIds);
        const weightSum = places.reduce((s, p) => s + (p.share ?? 1), 0);
        for (const p of places) {
          const share = (p.share ?? 1) / weightSum;
          add(p, (k.weight / total) * share, ci, amount);
        }
      }
    }
  }

  // Which accounts have something to show: the others are left out unless asked for.
  const used = cash.map((c, i) => opening[i] !== 0 || c.ledgerClosing !== 0 || rawNet[i] !== 0);
  const keep = cash.map((_, i) => opts.showEmptyAccounts || used[i]);
  const pick = <T,>(xs: T[]) => xs.filter((_, i) => keep[i]);
  const sum = (cells: number[]) => round2(cells.reduce((s, v) => s + v, 0));
  const roundCells = (cells: number[]) => pick(cells).map(round2);

  const build = (order: SectionKey[]): FlowSideTotals => {
    const sections: FlowSection[] = [];
    for (const key of order) {
      const lines: FlowLine[] = [];
      for (const [rk, r] of [...(rows.get(key)?.entries() ?? [])].sort(([, a], [, b]) => a.label.localeCompare(b.label))) {
        const cells = roundCells(r.cells);
        if (cells.every((v) => v === 0)) continue;
        const children: FlowLine[] = [...r.children.entries()]
          .sort(([, a], [, b]) => a.label.localeCompare(b.label))
          .map(([ck, k]) => ({ key: ck, label: k.label, accountId: k.accountId, cells: roundCells(k.cells), total: sum(pick(k.cells).map(round2)), children: [] }))
          .filter((k) => k.cells.some((v) => v !== 0));
        lines.push({ key: rk, label: r.label, accountId: r.accountId, cells, total: sum(cells), children });
      }
      if (lines.length === 0) continue;
      const cells = pick(new Array(n).fill(0)).map((_, i) => round2(lines.reduce((s, l) => s + l.cells[i], 0)));
      sections.push({ key, title: SECTION_TITLE[key], lines, cells, total: sum(cells) });
    }
    const cells = pick(new Array(n).fill(0)).map((_, i) => round2(sections.reduce((s, x) => s + x.cells[i], 0)));
    return { sections, cells, total: sum(cells) };
  };

  const moneyIn = build(IN_ORDER);
  const moneyOut = build(OUT_ORDER);
  const openingShown = pick(opening).map(round2);
  const closing = openingShown.map((o, i) => round2(o + moneyIn.cells[i] + moneyOut.cells[i]));
  const differences = pick(cash).map((c) => {
    const idx = cash.indexOf(c);
    return round2(c.ledgerClosing - (opening[idx] + rawNet[idx]));
  });
  const balanced = differences.every((d) => Math.abs(d) < 0.005);
  return {
    columns: pick(cash).map((c) => ({ accountId: c.id, name: c.name, code: c.code })),
    opening: openingShown,
    moneyIn,
    moneyOut,
    closing,
    differences,
    balanced,
    hasTransfers,
  };
}
