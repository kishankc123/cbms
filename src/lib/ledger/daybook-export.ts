import type { Daybook, DocSection } from "./daybook-rules";
import type { ListRow } from "./daybook-extras";

// What the Daybook looks like when it leaves the screen: the rows of the shareable image and of the spreadsheet. Pure (no browser, no database), so the
// layout can be tested; the drawing and the file writing are in the page's client code.

export const formatMoney = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ExportContext = { company: string; /** the date as the organization reads it, e.g. "24 Kartik 2083" */ dateLabel: string; /** the same day in the other calendar, shown small */ otherDateLabel: string; currency: string };

// ---- The image ----

export type ImageRow = { kind: "section" | "line" | "sub" | "rule" | "gap"; left?: string; right?: string };

export function imageRows(d: Daybook): ImageRow[] {
  const rows: ImageRow[] = [];
  const doc = (title: string, s: DocSection) => {
    rows.push({ kind: "section", left: title, right: formatMoney(s.total) });
    for (const m of s.byMode) rows.push({ kind: "sub", left: m.mode, right: formatMoney(m.amount) });
    if (s.returns > 0) rows.push({ kind: "sub", left: "Returns", right: `-${formatMoney(s.returns)}` });
    rows.push({ kind: "gap" });
  };
  doc("Sales", d.sales);
  doc("Purchases", d.purchases);
  doc("Expenses", d.expenses);
  rows.push({ kind: "rule" });
  rows.push({ kind: "line", left: "Money in", right: formatMoney(d.moneyIn) });
  rows.push({ kind: "line", left: "Money out", right: formatMoney(d.moneyOut) });
  rows.push({ kind: "line", left: "Net", right: formatMoney(d.net) });
  rows.push({ kind: "rule" });
  rows.push({ kind: "section", left: "Cash and bank", right: "Closing" });
  for (const g of d.groups) {
    rows.push({ kind: "line", left: g.label, right: formatMoney(g.closing) });
    rows.push({ kind: "sub", left: `Opening ${formatMoney(g.opening)}`, right: `In ${formatMoney(g.in)}  Out ${formatMoney(g.out)}` });
  }
  rows.push({ kind: "line", left: "Total", right: formatMoney(d.totals.closing) });
  rows.push({ kind: "sub", left: `Opening ${formatMoney(d.totals.opening)}`, right: "" });
  return rows;
}

// ---- The spreadsheet ----

export type Sheet = { name: string; rows: (string | number)[][] };

export function daybookSheets(d: Daybook, ctx: ExportContext, list: ListRow[] = []): Sheet[] {
  const head: (string | number)[][] = [[ctx.company], ["Daybook"], [`${ctx.dateLabel} (${ctx.otherDateLabel})`], []];
  const doc = (title: string, s: DocSection): (string | number)[][] => [[title, "Amount"], ...s.byMode.map((m) => [`  ${m.mode}`, m.amount]), ...(s.returns > 0 ? [["  Returns", -s.returns]] : []), [`Total ${title.toLowerCase()}`, s.total], []];
  const summary: (string | number)[][] = [
    ...head,
    ...doc("Sales", d.sales),
    ...doc("Purchases", d.purchases),
    ...doc("Expenses", d.expenses),
    ["Money in", d.moneyIn],
    ["Money out", d.moneyOut],
    ["Net", d.net],
    [],
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
