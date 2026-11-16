import type { Page, Sheet } from "./sheet-reader";

// The report as a spreadsheet: one worksheet per page, the company, title and period at the top, then the table with figures as real numbers.

const NUMBER = /^\(?-?[\d,]+(\.\d+)?\)?$/;
const FORMAT = "#,##0.00;(#,##0.00)";

/** "1,234.50" -> 1234.5, "(1,234.50)" -> -1234.5. Anything else (words, dashes, percentages) stays text, and a lone dash is left blank. */
export function parseCell(text: string): string | number {
  if (text === "-") return "";
  if (!NUMBER.test(text) || !/\d/.test(text)) return text;
  const n = parseFloat(text.replace(/[(),]/g, ""));
  return text.startsWith("(") ? -n : n;
}

const sheetName = (name: string, taken: Set<string>) => {
  const base = name.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "Report";
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base} ${i}`;
  taken.add(n);
  return n;
};

function worksheet(XLSX: typeof import("xlsx"), page: Page, foot: Sheet["foot"]) {
  const grid: (string | number)[][] = page.head.map((h) => [h.text]);
  grid.push([]);
  const widths: number[] = [];
  for (const row of page.rows) {
    const line: (string | number)[] = [];
    let col = 0;
    for (const c of row.cells) {
      line[col] = parseCell(c.text);
      widths[col] = Math.max(widths[col] ?? 0, c.span === 1 ? c.w : 0);
      col += c.span;
    }
    grid.push(row.spacer ? [] : Array.from(line, (v) => v ?? ""));
  }
  grid.push([], foot.filter(Boolean));
  const ws = XLSX.utils.aoa_to_sheet(grid);
  for (const addr of Object.keys(ws)) if (addr[0] !== "!" && ws[addr].t === "n") ws[addr].z = FORMAT;
  ws["!cols"] = widths.map((w) => ({ wch: Math.max(10, Math.round(w / 7)) }));
  return ws;
}

export async function toWorkbook(sheet: Sheet) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();
  for (const page of sheet.pages) XLSX.utils.book_append_sheet(wb, worksheet(XLSX, page, sheet.foot), sheetName(page.name, taken));
  return { XLSX, wb };
}
