import { IMPORT_FIELDS } from "./fields";
import type { FieldDef } from "@/lib/import-columns";
import type { PayKey } from "@/lib/import-payments";
import { PURCHASE_FIELDS } from "@/lib/purchases/import/fields";
import { EXPENSE_FIELDS } from "@/lib/expenses/import/fields";

// The criteria for each column of an import file, shown on the upload screen and written into the template. Pure.

export type ColumnGuideRow = { column: string; needed: "Required" | "Optional"; accepts: string; example: string };

const DATE = "A date written dd/mm/yyyy, in AD or BS (15/04/2083 or 31/07/2026). Format the Date column as Text so Excel keeps it as typed.";
const MONEY = "A number: digits with an optional decimal point. Commas are fine (12,500.00).";

type Rule = { accepts: string; example: string };

/** The payment columns, the same for all three imports: a document can be paid in up to three parts. */
const payRules = (totalNote: string, verb: string, example: string): Record<PayKey, Rule> => ({
  paid: { accepts: `${MONEY} ${totalNote}`, example },
  account: { accepts: `The name or code of one of your cash, bank or wallet accounts, or a payment mode that has just one account (Cash). Needed only when money was ${verb}.`, example: "Cash" },
  paid2: { accepts: "A second part of the payment, if it was paid in more than one way. The parts together can't be more than the total.", example: "825" },
  account2: { accepts: "The account the second part went through.", example: "Fonepay" },
  paid3: { accepts: "A third part, if needed.", example: "300" },
  account3: { accepts: "The account the third part went through.", example: "Wallet" },
});

function build<K extends string>(fields: FieldDef<K>[], rules: Record<K, Rule>): ColumnGuideRow[] {
  return fields.map((f) => ({
    column: f.label,
    needed: f.required ? "Required" : "Optional",
    accepts: rules[f.key].accepts,
    example: rules[f.key].example,
  }));
}

export const salesColumnGuide = (): ColumnGuideRow[] =>
  build(IMPORT_FIELDS, {
    date: { accepts: DATE, example: "15/04/2083" },
    amount: { accepts: `${MONEY} More than zero. The invoice amount, VAT included. A discount is taken off it, and the VAT is worked out from what is left.`, example: "11300" },
    customer: { accepts: "The customer's name as in your customers. Blank only for a cash sale paid in full.", example: "Himal Traders" },
    discount: { accepts: `${MONEY} Not more than the amount.`, example: "500" },
    billType: { accepts: "Taxable or Zero rated. Blank uses the default you choose.", example: "Taxable" },
    revenue: { accepts: "The name or code of a revenue account (lowest level only: a group that has sub-groups can't be used). Blank uses the default you choose.", example: "Sales Revenue" },
    ...payRules("Not more than the invoice total.", "received", "11300"),
  });

export const purchaseColumnGuide = (): ColumnGuideRow[] =>
  build(PURCHASE_FIELDS, {
    date: { accepts: DATE, example: "15/04/2083" },
    amount: { accepts: `${MONEY} More than zero. Before VAT, unless you tell the import it includes VAT.`, example: "5000" },
    supplier: { accepts: "The supplier's name as in your suppliers. Blank only for a purchase paid in full.", example: "Himal Traders" },
    category: { accepts: "The name or code of one of your purchase categories, or choose a default in the import.", example: "Stationery" },
    billNumber: { accepts: "The supplier's own bill number. Blank gets an automatic one.", example: "B-101" },
    description: { accepts: "Free text: what was bought.", example: "Office paper" },
    discount: { accepts: `${MONEY} Not more than the amount.`, example: "100" },
    billType: { accepts: "VAT, PAN, Estimate, Challan or No bill. Only a VAT bill carries VAT.", example: "VAT" },
    ...payRules("Not more than the bill total.", "paid", "0"),
  });

export const expenseColumnGuide = (): ColumnGuideRow[] =>
  build(EXPENSE_FIELDS, {
    date: { accepts: DATE, example: "15/04/2083" },
    amount: { accepts: `${MONEY} More than zero. Before VAT, unless you tell the import it includes VAT.`, example: "20000" },
    category: { accepts: "The name or code of one of your expense categories (lowest level only), or choose a default in the import.", example: "Rent" },
    supplier: { accepts: "The supplier's name as in your suppliers. Blank only for an expense paid in full.", example: "Landlord Ltd" },
    description: { accepts: "Free text: what it was for.", example: "Office rent" },
    invoiceNumber: { accepts: "The supplier's invoice number. Used to spot duplicates.", example: "R-101" },
    dueDate: { accepts: `${DATE} Not before the expense date.`, example: "30/04/2083" },
    billType: { accepts: "VAT, PAN, Estimate, Challan or No bill. Only a VAT bill carries VAT.", example: "PAN" },
    vat: { accepts: `${MONEY} Only with a VAT bill. Blank: worked out at the VAT rate.`, example: "2600" },
    tds: { accepts: `${MONEY} Withheld from the payee, so not more than the total.`, example: "1000" },
    ...payRules("Not more than the amount payable (after TDS).", "paid", "0"),
  });

/** The rows of the "Columns" sheet in a template. */
export const guideSheet = (guide: ColumnGuideRow[]): string[][] => [["Column", "Required?", "What to enter", "Example"], ...guide.map((g) => [g.column, g.needed, g.accepts, g.example])];
