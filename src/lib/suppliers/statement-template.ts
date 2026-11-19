import * as XLSX from "xlsx";

// The sheet a supplier can be asked to send their statement in. Its headings are the ones guessMapping already recognises, so a statement in this
// layout is read without choosing any columns.

export const STATEMENT_HEADERS = ["Date", "Document no.", "Particulars", "Debit", "Credit", "Balance"] as const;

export function buildStatementTemplate(): string {
  const wb = XLSX.utils.book_new();
  // Written from the supplier's own books: their bill to us is a debit, our payment to them is a credit, and the balance is what we owe them.
  const sheet = XLSX.utils.aoa_to_sheet([
    [...STATEMENT_HEADERS],
    ["15/04/2083", "INV-1001", "Goods supplied", 50000, "", 50000],
    ["25/04/2083", "RCT-501", "Payment received, cheque 000123", "", 30000, 20000],
  ]);
  sheet["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Statement");
  const notes = XLSX.utils.aoa_to_sheet([
    ["How to fill this sheet"],
    ["One row for each bill, return, payment or adjustment, oldest first. Delete the two sample rows."],
    ["Date: dd/mm/yyyy, AD or BS."],
    ["Document no.: the invoice, credit note, receipt or cheque number. This is what lets each row be matched with our books, so please fill it in for every row."],
    ["Particulars: a short description."],
    ["Debit: what the supplier billed us (the bill amount). Credit: what we paid them, or returns and credit notes."],
    ["Balance: the running balance after the row. Please keep it, it is used to check which way round the statement is written."],
    ["Do not add totals or blank rows between the entries."],
  ]);
  notes["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, notes, "How to fill");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}
