import * as XLSX from "xlsx";

// The sample statement file offered on the Upload Statement screen. The first sheet is the one the upload reads
// (parse-statement.ts), so the example rows come first and the explanations sit on later sheets.
export const STATEMENT_COLUMNS: { name: string; needed: string; meaning: string }[] = [
  { name: "Date", needed: "Required", meaning: "dd/mm/yyyy, in AD or BS (04/04/2083 or 17/07/2026). It is stored as AD." },
  { name: "Description", needed: "Optional", meaning: "The bank's narration. Helps matching and is shown in reconciliation." },
  { name: "Reference", needed: "Optional", meaning: "Cheque number, transaction ID or voucher number from the bank." },
  { name: "Debit", needed: "One layout needed", meaning: "Money out of the account (withdrawals, payments). Use with Credit." },
  { name: "Credit", needed: "One layout needed", meaning: "Money into the account (deposits, receipts). Use with Debit." },
  { name: "Amount", needed: "One layout needed", meaning: "Alternative to Debit and Credit: one signed column, money in positive and money out negative. Not used in this sample." },
  { name: "Balance", needed: "Optional", meaning: "The running balance after the row." },
];

export function buildStatementTemplate(): string {
  const wb = XLSX.utils.book_new();
  const statement = XLSX.utils.aoa_to_sheet([
    ["Date", "Description", "Reference", "Debit", "Credit", "Balance"],
    ["02/04/2083", "Cash deposit", "DEP-1001", "", 50000, 150000],
    ["05/04/2083", "Cheque payment to supplier", "CHQ-000231", 12500, "", 137500],
    ["09/04/2083", "Fonepay collection", "FP-77821", "", 8200, 145700],
    ["15/04/2083", "Bank charges", "", 150, "", 145550],
  ]);
  statement["!cols"] = [{ wch: 14 }, { wch: 34 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, statement, "Statement");

  const columns = XLSX.utils.aoa_to_sheet([["Column", "Needed?", "What to put in it"], ...STATEMENT_COLUMNS.map((c) => [c.name, c.needed, c.meaning])]);
  columns["!cols"] = [{ wch: 14 }, { wch: 18 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, columns, "Columns");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["How to use this sample"],
      ["Your bank's own file does not need to look like this: upload it as it is and match its columns on the next screen."],
      ["Use this sample only if you are preparing the statement by hand. Replace the example rows on the Statement sheet and keep the heading row."],
      ["Only the first sheet (Statement) is read. Keep it first."],
      ["Each row is one bank transaction. Rows with no readable date or a zero amount are skipped."],
      ["Uploading the same or an overlapping statement again skips transactions that were already imported."],
    ]),
    "How to use"
  );
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}
