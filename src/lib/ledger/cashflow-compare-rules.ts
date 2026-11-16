import type { Heading, Pair, Row, Section } from "./pnl-compare-rules";

// The cash flow statement for two periods side by side. Plain functions, no database, so they can be tested.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CashLine = { accountId: string; name: string; amount: number };
/** What `cashFlowStatement` returns for one period, as far as this table needs it. */
export type CashFlowPeriod = {
  netProfit: number;
  operating: CashLine[];
  investing: CashLine[];
  financing: CashLine[];
  netCashFromOperating: number;
  netCashFromInvesting: number;
  netCashFromFinancing: number;
  openingCash: number;
  closingCash: number;
  actualCashMovement: number;
};
export type CashFlowComparison = {
  operating: Section;
  investing: Section;
  financing: Section;
  netChange: Pair;
  opening: Pair;
  closing: Pair;
  /** Cash and bank at the end less what the three activities say it should be, for each period. Zero when the statement ties out. */
  difference: Pair;
};

// One section of lines, matched by account and name across the two periods. An activity with nothing in either period has no lines.
function lines(title: string, cur: CashLine[], prev: CashLine[], leading?: Row): Section {
  const rows = new Map<string, Row>();
  for (const [period, list] of [["cur", cur], ["prev", prev]] as const) {
    for (const l of list) {
      const key = `${l.accountId}|${l.name}`;
      const row = rows.get(key) ?? { accountId: l.accountId, sub: l.name, cur: 0, prev: 0 };
      row[period] = round2(row[period] + l.amount);
      rows.set(key, row);
    }
  }
  const all = [...(leading ? [leading] : []), ...rows.values()];
  const heading: Heading = { key: title, name: title, rows: all };
  return { headings: all.length > 0 ? [heading] : [], cur: round2(all.reduce((s, r) => s + r.cur, 0)), prev: round2(all.reduce((s, r) => s + r.prev, 0)) };
}

export function buildCashFlowComparison(cur: CashFlowPeriod, prev: CashFlowPeriod): CashFlowComparison {
  // Operating starts from the period's profit; the adjustments below it turn that profit into cash.
  const operating = lines("Operating activities", cur.operating, prev.operating, { accountId: "", sub: "Net profit", cur: cur.netProfit, prev: prev.netProfit });
  const investing = lines("Investing activities", cur.investing, prev.investing);
  const financing = lines("Financing activities", cur.financing, prev.financing);
  const netChange = { cur: round2(operating.cur + investing.cur + financing.cur), prev: round2(operating.prev + investing.prev + financing.prev) };
  const closing = { cur: cur.closingCash, prev: prev.closingCash };
  const opening = { cur: cur.openingCash, prev: prev.openingCash };
  return { operating, investing, financing, netChange, opening, closing, difference: { cur: round2(closing.cur - opening.cur - netChange.cur), prev: round2(closing.prev - opening.prev - netChange.prev) } };
}

export const EMPTY_PERIOD: CashFlowPeriod = { netProfit: 0, operating: [], investing: [], financing: [], netCashFromOperating: 0, netCashFromInvesting: 0, netCashFromFinancing: 0, openingCash: 0, closingCash: 0, actualCashMovement: 0 };
