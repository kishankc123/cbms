import type { ColumnMapping, FieldDef } from "@/lib/import-columns";
import { payFields, type PayKey } from "@/lib/import-payments";

// The columns Import Expenses understands (one row = one expense).

export type ExpenseFieldKey = "date" | "amount" | "category" | "supplier" | "description" | "invoiceNumber" | "dueDate" | "billType" | "vat" | "tds" | PayKey;

export const EXPENSE_FIELDS: FieldDef<ExpenseFieldKey>[] = [
  { key: "date", label: "Date", required: true, help: "dd/mm/yyyy, in AD or BS." },
  { key: "amount", label: "Amount", required: true, help: "The expense amount, before VAT unless you say it includes VAT." },
  { key: "category", label: "Category", required: false, help: "The expense category it is booked to." },
  { key: "supplier", label: "Supplier", required: false, help: "Leave blank for an expense paid in full to no one in particular." },
  { key: "description", label: "Description", required: false, help: "What it was for." },
  { key: "invoiceNumber", label: "Invoice number", required: false, help: "The supplier's invoice number." },
  { key: "dueDate", label: "Due date", required: false, help: "When an unpaid expense is due." },
  { key: "billType", label: "Bill type", required: false, help: "VAT, PAN, estimate, challan or no bill." },
  { key: "vat", label: "VAT amount", required: false, help: "If the file has the VAT amount. Otherwise VAT bills are worked out at the VAT rate." },
  { key: "tds", label: "TDS amount", required: false, help: "Tax withheld from the payee." },
  ...payFields("Paid from", "How much has been paid.", "The cash or bank account name."),
];

export type ExpenseColumnMapping = ColumnMapping<ExpenseFieldKey>;
