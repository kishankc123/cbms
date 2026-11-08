import type { Daybook, DocSection } from "./daybook-rules";
import type { ListRow } from "./daybook-extras";
import { chequeChip, type DayCheques } from "./daybook-cheques";
import { groupedFlows, type FlowRow, type MonthTotals } from "./daybook-extras";

// What the Daybook looks like when it leaves the screen: the rows of the shareable image and of the spreadsheet. Pure (no browser, no database), so the
// layout can be tested; the drawing and the file writing are in the page's client code.

export const formatMoney = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ExportContext = { company: string; /** the date as the organization reads it, e.g. "24 Kartik 2083" */ dateLabel: string; /** the same day in the other calendar, shown small */ otherDateLabel: string; currency: string };

// ---- What goes with the day ----

/** Everything besides the day's own figures that the image and the spreadsheet show. */
export type DayExtras = {
  /** the first day of the month so far, as the organization reads it, e.g. "1 Kartik 2083" */
  monthLabel: string;
  month: MonthTotals;
  flows: FlowRow[];
  credit: { given: number; taken: number };
  /** the cash count saved for the day, added up over the cash accounts, or null when none was saved */
  cashCount: { counted: number; books: number } | null;
  cheques: DayCheques;
};

// ---- The image ----

export type ImageCard = { title: string; total: string; month: string; modes: { label: string; amount: string; share: number }[]; returns: string | null };
export type ImageTable = { columns: string[]; rows: { label: string; values: string[]; strong?: boolean; /** colours the figures: green for money in, red for money out */ tone?: "in" | "out" }[] };
export type ImageModel = {
  cards: ImageCard[];
  note: string;
  flows: { label: string; today: string; month: string; quiet: boolean; sub: boolean }[];
  cash: ImageTable;
  monthCash: string;
  chips: string[];
};

const MAX_ACCOUNT_COLUMNS = 5;
const dash = "—";

/** One column per cash, bank or wallet account (cash first), and the rest together as "Other accounts" when there are more than the picture has room for. */
export function accountColumns(d: Daybook, max = MAX_ACCOUNT_COLUMNS): { name: string; opening: number; in: number; out: number; transfers: number; closing: number }[] {
  const sorted = [...d.accounts].sort((a, b) => (a.group === b.group ? a.code.localeCompare(b.code) : a.group === "cash" ? -1 : 1));
  const cols = sorted.map((a) => ({ name: a.name, opening: a.opening, in: a.in, out: a.out, transfers: a.transfers, closing: a.closing }));
  if (cols.length <= max) return cols;
  const rest = cols.slice(max - 1);
  const sum = (k: "opening" | "in" | "out" | "transfers" | "closing") => Math.round(rest.reduce((s, c) => s + c[k], 0) * 100) / 100;
  return [...cols.slice(0, max - 1), { name: "Other accounts", opening: sum("opening"), in: sum("in"), out: sum("out"), transfers: sum("transfers"), closing: sum("closing") }];
}

export function imageModel(d: Daybook, x: DayExtras): ImageModel {
  const card = (title: string, s: DocSection, month: number): ImageCard => {
    const modeTotal = s.byMode.reduce((t, m) => t + Math.max(0, m.amount), 0);
    return {
      title,
      total: formatMoney(s.total),
      month: formatMoney(month),
      modes: s.byMode.map((m) => ({ label: m.mode, amount: formatMoney(m.amount), share: modeTotal > 0 ? Math.max(0, m.amount) / modeTotal : 0 })),
      returns: s.returns > 0 ? formatMoney(s.returns) : null,
    };
  };
  const notes = [x.credit.given > 0 ? `Credit given today ${formatMoney(x.credit.given)}` : "", x.credit.taken > 0 ? `credit taken ${formatMoney(x.credit.taken)}` : "", `month so far is from ${x.monthLabel}`].filter(Boolean);

  const cols = accountColumns(d);
  const tot = (k: "opening" | "in" | "out" | "transfers" | "closing") => d.totals[k];
  const money = (n: number, sign: string) => (Math.abs(n) < 0.005 ? dash : `${n < 0 ? "-" : sign}${formatMoney(Math.abs(n))}`);
  const rows: ImageTable["rows"] = [
    { label: "Opening", values: [...cols.map((c) => formatMoney(c.opening)), formatMoney(tot("opening"))] },
    { label: "Money in", values: [...cols.map((c) => money(c.in, "+")), money(tot("in"), "+")], tone: "in" },
    { label: "Money out", values: [...cols.map((c) => money(-c.out, "-")), money(-tot("out"), "-")], tone: "out" },
  ];
  if (d.accounts.some((a) => Math.abs(a.transfers) >= 0.005)) rows.push({ label: "Moved", values: [...cols.map((c) => money(c.transfers, "+")), money(tot("transfers"), "+")] });
  rows.push({ label: "Closing", values: [...cols.map((c) => formatMoney(c.closing)), formatMoney(tot("closing"))], strong: true });

  const chips: string[] = [];
  if (x.cashCount) {
    const diff = Math.round((x.cashCount.counted - x.cashCount.books) * 100) / 100;
    chips.push(`Cash count: counted ${formatMoney(x.cashCount.counted)} · books ${formatMoney(x.cashCount.books)} · ${diff === 0 ? "matches" : diff < 0 ? `short ${formatMoney(-diff)}` : `over ${formatMoney(diff)}`}`);
  }
  const cq = chequeChip(x.cheques, formatMoney);
  if (cq) chips.push(`Cheques: ${cq}`);

  return {
    cards: [card("Sales", d.sales, x.month.sales), card("Purchases", d.purchases, x.month.purchases), card("Expenses", d.expenses, x.month.expenses)],
    note: notes.join(" · ").replace(/^./, (c) => c.toUpperCase()),
    flows: groupedFlows(x.flows).map((r) => ({ label: r.label, today: r.today > 0 ? formatMoney(r.today) : dash, month: formatMoney(r.month), quiet: r.today <= 0, sub: Boolean(r.sub) })),
    cash: { columns: [...cols.map((c) => c.name), "Total"], rows },
    monthCash: `This month: money in ${formatMoney(x.month.moneyIn)} · money out ${formatMoney(x.month.moneyOut)}`,
    chips,
  };
}

// ---- The spreadsheet ----

export type Sheet = { name: string; rows: (string | number)[][] };

export function daybookSheets(d: Daybook, ctx: ExportContext, list: ListRow[] = [], cheques?: DayCheques, extras?: DayExtras): Sheet[] {
  const head: (string | number)[][] = [[ctx.company], ["Daybook"], [`${ctx.dateLabel} (${ctx.otherDateLabel})`], []];
  const withMonth = (row: (string | number)[], month?: number) => (extras && month !== undefined ? [...row, month] : row);
  const doc = (title: string, s: DocSection, month?: number): (string | number)[][] => [
    extras ? [title, "Today", "This month"] : [title, "Amount"],
    ...s.byMode.map((m) => [`  ${m.mode}`, m.amount]),
    ...(s.returns > 0 ? [["  Returns", -s.returns]] : []),
    withMonth([`Total ${title.toLowerCase()}`, s.total], month),
    [],
  ];
  const summary: (string | number)[][] = [
    ...head,
    ...doc("Sales", d.sales, extras?.month.sales),
    ...doc("Purchases", d.purchases, extras?.month.purchases),
    ...doc("Expenses", d.expenses, extras?.month.expenses),
    withMonth(["Money in", d.moneyIn], extras?.month.moneyIn),
    withMonth(["Money out", d.moneyOut], extras?.month.moneyOut),
    ["Net", d.net],
    [],
    ...(extras
      ? [
          ["Collections and payments", "Today", "This month"],
          ...groupedFlows(extras.flows).map((r) => [r.sub ? `  ${r.label}` : r.label, r.today, r.month]),
          [],
          ["Credit given today", extras.credit.given],
          ["Credit taken today", extras.credit.taken],
          ...(extras.cashCount ? [["Cash counted", extras.cashCount.counted], ["Cash in the books", extras.cashCount.books], ["Counted minus books", Math.round((extras.cashCount.counted - extras.cashCount.books) * 100) / 100]] : []),
          [`Month so far is from ${extras.monthLabel}`],
          [],
        ]
      : []),
    ["Other money movements", "In", "Out"],
    ...d.other.map((o) => [o.label, o.in, o.out]),
    ["Moved between your own accounts", d.transfersMoved],
  ];
  const cash: (string | number)[][] = [
    [ctx.company, "Daybook", ctx.dateLabel],
    [],
    ["Account", "Opening", "In", "Out", "Moved between accounts", "Closing"],
    ...d.groups.flatMap((g) => [[g.label, g.opening, g.in, g.out, g.transfers, g.closing], ...d.accounts.filter((a) => a.group === g.group).map((a) => [`  ${a.code} ${a.name}`, a.opening, a.in, a.out, a.transfers, a.closing])]),
    ["Total", d.totals.opening, d.totals.in, d.totals.out, d.totals.transfers, d.totals.closing],
  ];
  const sheets: Sheet[] = [{ name: "Daybook", rows: summary }, { name: "Cash and bank", rows: cash }];
  if (list.length > 0) {
    sheets.push({
      name: "Entries",
      rows: [[ctx.company, "Daybook", ctx.dateLabel], [], ["What", "Reference", "Note", "Amount"], ...list.map((r) => [r.correction ? `${r.kind} (correction)` : r.kind, r.reference, r.note, r.amount])],
    });
  }
  if (cheques?.any) {
    sheets.push({
      name: "Cheques",
      rows: [
        [ctx.company, "Daybook", ctx.dateLabel],
        [],
        ["Group", "Direction", "Cheque number", "Name", "Cheque date", "Amount"],
        ...cheques.groups.flatMap((g) => g.rows.map((r) => [g.label, r.kind === "issued" ? "We give" : "We get", r.number, r.party, r.chequeDate, r.amount])),
      ],
    });
  }
  return sheets;
}

/** A sheet as comma-separated text. */
export function sheetCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number | undefined) => (v === undefined ? "" : typeof v === "number" ? v.toFixed(2) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}

/** A file name that sorts by date and is safe on every system. */
export function exportFileName(company: string, day: string, ext: string): string {
  const safe = company.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "Business";
  return `Daybook-${safe}-${day}.${ext}`;
}

// ---- A range of days ----

import type { DaybookRange } from "./daybook-range";

/** The spreadsheet of a range: a row for every day, then the whole stretch laid out like a single day. `dayLabel` writes a date the way the organization reads it. */
export function rangeSheets(r: DaybookRange, ctx: ExportContext, dayLabel: (iso: string) => string): Sheet[] {
  const t = r.total;
  const days: (string | number)[][] = [
    [ctx.company, "Daybook", ctx.dateLabel],
    [],
    ["Date", "Sales", "Purchases", "Expenses", "Money in", "Money out", "Cash and bank at close"],
    ...r.days.map((d) => [dayLabel(d.day), d.sales, d.purchases, d.expenses, d.moneyIn, d.moneyOut, d.closing]),
    ["Total", t.sales.total, t.purchases.total, t.expenses.total, t.moneyIn, t.moneyOut, t.totals.closing],
  ];
  return [{ name: "Days", rows: days }, ...daybookSheets(t, ctx).map((s) => ({ ...s, name: s.name === "Daybook" ? "Whole period" : s.name }))];
}
