// Reads a report as it is on screen (the #report-sheet) into plain rows, so the same report can be saved as a spreadsheet, a picture or a PDF without each
// report describing itself three times. Browser only. It works on a hidden copy at a fixed width, so a file looks the same whatever the window size.

export const SHEET_WIDTH = 1100;

export type Cell = { text: string; x: number; w: number; span: number; align: "left" | "right" | "center"; bold: boolean; size: number; tone: "in" | "out" | null };
export type Row = { cells: Cell[]; y: number; h: number; spacer: boolean; shaded: boolean; ruleTop: boolean; ruleBottom: boolean };
export type HeadLine = { text: string; bold: boolean; size: number };
export type Page = { head: HeadLine[]; rows: Row[]; width: number; height: number; name: string };
export type Sheet = { pages: Page[]; foot: [string, string]; name: string };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const num = (v: string) => parseFloat(v) || 0;

// Money in green and money out in red are told apart by hue, whichever theme the app is in.
function toneOf(color: string): Cell["tone"] {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(Number);
  if (r > g + 40 && r > b + 40) return "out";
  if (g > r + 30 && g >= b) return "in";
  return null;
}

function readPage(page: HTMLElement, index: number): Page {
  const head = [...page.querySelectorAll("[data-report-header] > *")].map((el) => {
    const s = getComputedStyle(el);
    return { text: clean(el.textContent), bold: num(s.fontWeight) >= 500, size: num(s.fontSize) };
  });
  const table = page.querySelector("table");
  const origin = table?.getBoundingClientRect() ?? { left: 0, top: 0, width: SHEET_WIDTH };
  const rows: Row[] = [...(table?.rows ?? [])].map((tr) => {
    const r = tr.getBoundingClientRect();
    const s = getComputedStyle(tr);
    const cells = [...tr.cells].map((td): Cell => {
      const box = td.getBoundingClientRect();
      const cs = getComputedStyle(td);
      return {
        text: clean(td.textContent),
        x: box.left - origin.left,
        w: box.width,
        span: td.colSpan,
        align: cs.textAlign === "right" || cs.textAlign === "end" ? "right" : cs.textAlign === "center" ? "center" : "left",
        bold: num(cs.fontWeight) >= 500,
        size: num(cs.fontSize),
        tone: toneOf(cs.color),
      };
    });
    const bg = cells.length ? getComputedStyle(tr.cells[0]).backgroundColor : "";
    return { cells, y: r.top - origin.top, h: r.height, spacer: tr.getAttribute("aria-hidden") === "true", shaded: !!bg && !/rgba\(.*,\s*0\)$|transparent/.test(bg), ruleTop: num(s.borderTopWidth) > 0, ruleBottom: num(s.borderBottomWidth) > 0 };
  });
  const title = head.find((h, i) => i > 0 && h.bold)?.text ?? `Report ${index + 1}`;
  return { head, rows, width: origin.width, height: rows.reduce((m, r) => Math.max(m, r.y + r.h), 0), name: title };
}

export function readSheet(sheet: HTMLElement): Sheet {
  const copy = sheet.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  Object.assign(copy.style, { position: "absolute", left: "-10000px", top: "0", width: `${SHEET_WIDTH}px` });
  document.body.append(copy);
  try {
    const sections = [...copy.querySelectorAll<HTMLElement>(":scope > section")];
    const pages = (sections.length ? sections : [copy]).map(readPage);
    const foot = [...copy.querySelectorAll("[data-report-footer] > span")].map((s) => clean(s.textContent));
    const first = pages[0]?.head.map((h) => h.text) ?? [];
    return { pages, foot: [foot[0] ?? "", foot[1] ?? ""], name: [first[0], sections.length ? "Quarterly pack" : first[first.length - 2], first[first.length - 1]].filter(Boolean).join(" - ") };
  } finally {
    copy.remove();
  }
}
