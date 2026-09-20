import * as XLSX from "xlsx";

export type ParsedStatementFile = {
  headers: string[];
  rows: string[][];
};

// Parses a CSV or Excel file (as a base64 data URL or raw base64 string) into
// a header row plus raw string rows — column mapping happens afterwards, so
// this stays format-agnostic beyond "produce a grid of cells."
export function parseStatementFile(base64: string, fileName: string): ParsedStatementFile {
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const binary = Buffer.from(base64, "base64");

  if (isCsv) {
    return parseCsv(binary.toString("utf-8"));
  }

  // cellDates: true so real Excel dates (AD serial numbers) come back as dates, not as locale-formatted text.
  const workbook = XLSX.read(binary, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const grid: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
  return gridToParsed(grid);
}

function parseCsv(text: string): ParsedStatementFile {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  const grid = lines.map(parseCsvLine);
  return gridToParsed(grid);
}

// Minimal RFC-4180-ish CSV line parser — handles quoted fields and escaped
// quotes ("") without pulling in a dependency for something this contained.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function gridToParsed(grid: string[][]): ParsedStatementFile {
  const [headerRow, ...rest] = grid;
  const headers = (headerRow ?? []).map((h) => String(h).trim());
  const rows = rest.filter((r) => r.some((c) => String(c).trim().length > 0)).map((r) => r.map((c) => String(c)));
  return { headers, rows };
}
