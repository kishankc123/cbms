import { suggestMappingFrom, type FieldDef } from "@/lib/sales/import/fields";

// The columns Import Expenses understands (one row = one expense). Header matching is shared with the other imports.

export type ExpenseFieldKey = "date" | "amount" | "category" | "supplier" | "description" | "invoiceNumber" | "dueDate" | "billType" | "vat" | "tds" | "paid" | "account";

export const EXPENSE_FIELDS: FieldDef<ExpenseFieldKey>[] = [
  { key: "date", label: "Date", required: true, synonyms: ["date", "expense date", "bill date", "voucher date", "txn date", "transaction date", "miti", "मिति"], help: "AD or BS dates both work." },
  { key: "amount", label: "Amount", required: true, synonyms: ["amount", "expense amount", "taxable amount", "net amount", "basic amount", "bill amount", "value", "total"], help: "The expense amount, before VAT unless you say it includes VAT." },
  { key: "category", label: "Category", required: false, synonyms: ["category", "expense category", "expense head", "head", "account head", "ledger", "type"], help: "The expense category it is booked to." },
  { key: "supplier", label: "Supplier", required: false, synonyms: ["supplier", "supplier name", "vendor", "vendor name", "payee", "paid to", "party", "party name", "name"], help: "Leave blank for an expense paid in full to no one in particular." },
  { key: "description", label: "Description", required: false, synonyms: ["description", "particulars", "details", "narration", "remarks", "note"], help: "What it was for." },
  { key: "invoiceNumber", label: "Invoice number", required: false, synonyms: ["invoice number", "invoice no", "invoice no.", "bill number", "bill no", "bill no.", "reference", "ref no", "voucher no"], help: "The supplier's invoice number." },
  { key: "dueDate", label: "Due date", required: false, synonyms: ["due date", "due on", "payment due", "due"], help: "When an unpaid expense is due." },
  { key: "billType", label: "Bill type", required: false, synonyms: ["bill type", "tax type", "vat type", "pan vat"], help: "VAT, PAN, estimate, challan or no bill." },
  { key: "vat", label: "VAT amount", required: false, synonyms: ["vat amount", "vat", "tax amount", "vat 13", "vat 13%"], help: "If the file has the VAT amount. Otherwise VAT bills are worked out at the VAT rate." },
  { key: "tds", label: "TDS amount", required: false, synonyms: ["tds amount", "tds", "withholding", "tax deducted", "tds deducted"], help: "Tax withheld from the payee." },
  { key: "paid", label: "Paid amount", required: false, synonyms: ["paid", "paid amount", "amount paid", "payment", "cash paid", "settled"], help: "How much has been paid." },
  { key: "account", label: "Paid from", required: false, synonyms: ["paid from", "payment account", "paid through", "bank", "cash/bank", "cash bank", "payment mode", "mode"], help: "The cash or bank account name." },
];

export type ExpenseColumnMapping = Partial<Record<ExpenseFieldKey, string>>;

export const suggestExpenseMapping = (headers: string[]): ExpenseColumnMapping => suggestMappingFrom(EXPENSE_FIELDS, headers);

export const expenseMappingComplete = (m: ExpenseColumnMapping) => EXPENSE_FIELDS.filter((f) => f.required).every((f) => Boolean(m[f.key]));
