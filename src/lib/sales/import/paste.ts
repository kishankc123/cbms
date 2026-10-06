// Turning cells copied from a spreadsheet into a CSV the import can read. Copying from Excel or Google Sheets puts the cells
// on the clipboard as tab-separated text, with any cell that holds a tab, a quote or a line break wrapped in quotes.

/** Splits tab-separated text into rows of cells, honouring quoted cells ("" is a literal quote). Blank lines are dropped. */
export function parsePasted(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const csvCell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);

/** The pasted cells as CSV text (first row = the headers), or null when there is nothing usable. */
export function pastedToCsv(text: string): string | null {
  const rows = parsePasted(text);
  if (rows.length < 2) return null;
  return rows.map((r) => r.map((c) => csvCell(c.trim())).join(",")).join("\n");
}
