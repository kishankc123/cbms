import { describe, expect, it } from "vitest";
import { A4, buildPdf, sliceHeights } from "./pdf";
import { parseCell } from "./sheet-xlsx";

describe("reading a figure from the screen", () => {
  it("turns money into numbers, brackets into negatives, and leaves words, dashes and percentages alone", () => {
    expect([parseCell("1,234.50"), parseCell("(1,234.50)"), parseCell("500"), parseCell("-")]).toEqual([1234.5, -1234.5, 500, ""]);
    expect([parseCell("Total income"), parseCell("12%"), parseCell("(5.0%)"), parseCell("01-04-2083"), parseCell("new")]).toEqual(["Total income", "12%", "(5.0%)", "01-04-2083", "new"]);
  });
});

describe("the PDF", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const [pageWidth, pageHeight] = A4.landscape;
  const bytes = buildPdf([{ jpeg, width: 2200, height: 900, pageWidth, pageHeight, margin: 24 }, { jpeg, width: 2200, height: 400, pageWidth, pageHeight, margin: 24 }]);
  const text = new TextDecoder("latin1").decode(bytes);

  it("is a PDF with a page for each picture", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/Filter /DCTDecode /Length 4");
  });

  it("has a table of contents whose every offset points at its object", () => {
    const table = text.slice(text.indexOf("xref\n")).split("\n").slice(3);
    const entries = table.filter((l) => /^\d{10} 00000 n $/.test(l));
    expect(entries).toHaveLength(8);
    entries.forEach((e, i) => expect(text.slice(Number(e.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(text).toContain(`startxref\n${text.indexOf("xref\n")}\n`);
  });

  it("cuts a tall picture into pieces that each fit a page", () => {
    const pieces = sliceHeights(2200, 7000, 595, 842, 24);
    expect(pieces.reduce((a, b) => a + b, 0)).toBe(7000);
    expect(Math.max(...pieces)).toBeLessThanOrEqual(Math.floor(((842 - 48) / (595 - 48)) * 2200));
    expect(sliceHeights(2200, 500, 595, 842, 24)).toEqual([500]);
  });
});

describe("the spreadsheet", () => {
  const cell = (text: string, span = 1) => ({ text, x: 0, w: 100, span, align: "left" as const, bold: false, size: 13, tone: null });
  const row = (cells: ReturnType<typeof cell>[], spacer = false) => ({ cells, y: 0, h: 20, spacer, shaded: false, ruleTop: false, ruleBottom: false });
  const sheet = {
    name: "Test",
    foot: ["Prepared on 30 Kartik 2083", "Made with Workdela"] as [string, string],
    pages: [{ name: "Profit & Loss", width: 1000, height: 100, head: [{ text: "My Company", bold: true, size: 16 }, { text: "Profit & Loss", bold: true, size: 13 }], rows: [row([cell("Heading"), cell("Sub-heading"), cell("Amount")]), row([cell("Income"), cell("Sales"), cell("1,000.50")]), row([cell("Cost"), cell("Stock"), cell("(250.00)")]), row([cell("gap")], true), row([cell("Total", 2), cell("750.50")])] }],
  };

  it("has one worksheet per page, the heading on top, and figures as real numbers", async () => {
    const { toWorkbook } = await import("./sheet-xlsx");
    const { XLSX, wb } = await toWorkbook(sheet);
    expect(wb.SheetNames).toEqual(["Profit & Loss"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    expect(rows[0]).toEqual(["My Company", "", ""]);
    expect(rows[4]).toEqual(["Income", "Sales", 1000.5]);
    expect(rows[5]).toEqual(["Cost", "Stock", -250]);
    expect(rows[7]).toEqual(["Total", "", 750.5]);
    expect(rows.at(-1)).toEqual(["Prepared on 30 Kartik 2083", "Made with Workdela", ""]);
  });
});
