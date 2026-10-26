// The columns Import Sales understands: the template's own column names. Pure: no database.

import type { ColumnMapping, FieldDef } from "@/lib/import-columns";
import { payFields, type PayKey } from "@/lib/import-payments";

export type ImportFieldKey = "date" | "customer" | "amount" | "discount" | "billType" | "revenue" | PayKey;
export type ImportField = FieldDef<ImportFieldKey>;

export const IMPORT_FIELDS: ImportField[] = [
  { key: "date", label: "Date", required: true, help: "dd/mm/yyyy, in AD or BS." },
  { key: "amount", label: "Amount", required: true, help: "The invoice amount, VAT included (a discount is taken off it)." },
  { key: "customer", label: "Customer", required: false, help: "Leave blank for cash sales that are paid in full." },
  { key: "discount", label: "Discount", required: false, help: "Optional." },
  { key: "billType", label: "Bill type", required: false, help: "Taxable or zero-rated." },
  { key: "revenue", label: "Revenue account", required: false, help: "The revenue account the sale is booked to. Blank uses the default you choose (Sales Revenue)." },
  ...payFields("Received into", "How much has been received for the invoice.", "The cash or bank account name."),
];

export type SalesColumnMapping = ColumnMapping<ImportFieldKey>;
