import { IMPORT_FIELDS, type FieldDef } from "./fields";
import { PURCHASE_FIELDS } from "@/lib/purchases/import/fields";
import { EXPENSE_FIELDS } from "@/lib/expenses/import/fields";

// The criteria for each column of an import file, shown on the upload screen and written into the template. Pure.

export type ColumnGuideRow = { column: string; needed: "Required" | "Optional"; accepts: string; example: string; alsoRead: string };

const DATE = "A date, AD or BS (2083-04-15 or 2026-07-31). Day-first is assumed unless the file says otherwise.";
const MONEY = "A number: digits with an optional decimal point. Commas are fine (12,500.00).";

type Rule = { accepts: string; example: string };

function build<K extends string>(fields: FieldDef<K>[], rules: Record<K, Rule>): ColumnGuideRow[] {
  return fields.map((f) => ({
    column: f.label,
    needed: f.required ? "Required" : "Optional",
    accepts: rules[f.key].accepts,
    example: rules[f.key].example,
    alsoRead: f.synonyms.slice(0, 4).join(", "),
  }));
}

export const salesColumnGuide = (): ColumnGuideRow[] =>
  build(IMPORT_FIELDS, {
    date: { accepts: DATE, example: "2083-04-15" },
    amount: { accepts: `${MONEY} More than zero. Before VAT, unless you tell the import it includes VAT.`, example: "10000" },
    customer: { accepts: "The customer's name as in your customers. Blank only for a cash sale paid in full.", example: "Himal Traders" },
    discount: { accepts: `${MONEY} Not more than the amount.`, example: "500" },
    billType: { accepts: "Taxable or Zero rated. Blank uses the default you choose.", example: "Taxable" },
    revenue: { accepts: "The name or code of a revenue account (lowest level only: a group that has sub-groups can't be used). Blank uses the default you choose.", example: "Sales Revenue" },
    paid: { accepts: `${MONEY} Not more than the invoice total.`, example: "11300" },
    account: { accepts: "The name or code of one of your cash or bank accounts. Needed only when money was received.", example: "Cash" },
  });

export const purchaseColumnGuide = (): ColumnGuideRow[] =>
  build(PURCHASE_FIELDS, {
    date: { accepts: DATE, example: "2083-04-15" },
    amount: { accepts: `${MONEY} More than zero. Before VAT, unless you tell the import it includes VAT.`, example: "5000" },
    supplier: { accepts: "The supplier's name as in your suppliers. Blank only for a purchase paid in full.", example: "Himal Traders" },
    category: { accepts: "The name or code of one of your purchase categories, or choose a default in the import.", example: "Stationery" },
    billNumber: { accepts: "The supplier's own bill number. Blank gets an automatic one.", example: "B-101" },
    description: { accepts: "Free text: what was bought.", example: "Office paper" },
    discount: { accepts: `${MONEY} Not more than the amount.`, example: "100" },
    billType: { accepts: "VAT, PAN, Estimate, Challan or No bill. Only a VAT bill carries VAT.", example: "VAT" },
    paid: { accepts: `${MONEY} Not more than the bill total.`, example: "0" },
    account: { accepts: "The name or code of one of your cash or bank accounts. Needed only when money was paid.", example: "Cash" },
  });

export const expenseColumnGuide = (): ColumnGuideRow[] =>
  build(EXPENSE_FIELDS, {
    date: { accepts: DATE, example: "2083-04-15" },
    amount: { accepts: `${MONEY} More than zero. Before VAT, unless you tell the import it includes VAT.`, example: "20000" },
    category: { accepts: "The name or code of one of your expense categories (lowest level only), or choose a default in the import.", example: "Rent" },
    supplier: { accepts: "The supplier's name as in your suppliers. Blank only for an expense paid in full.", example: "Landlord Ltd" },
    description: { accepts: "Free text: what it was for.", example: "Office rent" },
    invoiceNumber: { accepts: "The supplier's invoice number. Used to spot duplicates.", example: "R-101" },
    dueDate: { accepts: `${DATE} Not before the expense date.`, example: "2083-04-30" },
    billType: { accepts: "VAT, PAN, Estimate, Challan or No bill. Only a VAT bill carries VAT.", example: "PAN" },
    vat: { accepts: `${MONEY} Only with a VAT bill. Blank: worked out at the VAT rate.`, example: "2600" },
    tds: { accepts: `${MONEY} Withheld from the payee, so not more than the total.`, example: "1000" },
    paid: { accepts: `${MONEY} Not more than the amount payable (after TDS).`, example: "0" },
    account: { accepts: "The name or code of one of your cash or bank accounts. Needed only when money was paid.", example: "Cash" },
  });

/** The rows of the "Columns" sheet in a template. */
export const guideSheet = (guide: ColumnGuideRow[]): string[][] => [["Column", "Required?", "What to enter", "Example", "Other names it is found by"], ...guide.map((g) => [g.column, g.needed, g.accepts, g.example, g.alsoRead])];
