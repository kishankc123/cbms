import { suggestMappingFrom, type FieldDef } from "@/lib/sales/import/fields";

// The columns Import Purchases understands (one row = one consumable bill). Header matching is shared with Import Sales.

export type PurchaseFieldKey = "date" | "amount" | "supplier" | "category" | "billNumber" | "description" | "discount" | "billType" | "paid" | "account";

export const PURCHASE_FIELDS: FieldDef<PurchaseFieldKey>[] = [
  { key: "date", label: "Date", required: true, synonyms: ["date", "bill date", "purchase date", "invoice date", "txn date", "transaction date", "miti", "मिति"], help: "AD or BS dates both work." },
  { key: "amount", label: "Amount", required: true, synonyms: ["amount", "purchase amount", "bill amount", "taxable amount", "net amount", "basic amount", "invoice amount", "value", "total"], help: "The bill amount, before VAT unless you say it includes VAT." },
  { key: "supplier", label: "Supplier", required: false, synonyms: ["supplier", "supplier name", "vendor", "vendor name", "party", "party name", "seller", "paid to", "name"], help: "Leave blank for a purchase paid in full to no one in particular." },
  { key: "category", label: "Category", required: false, synonyms: ["category", "purchase category", "expense category", "account", "head", "item category", "type"], help: "The purchase category it is booked to." },
  { key: "billNumber", label: "Bill number", required: false, synonyms: ["bill number", "bill no", "bill no.", "invoice number", "invoice no", "supplier invoice", "reference", "ref no", "voucher no"], help: "The supplier's own number. Blank gets an automatic one." },
  { key: "description", label: "Description", required: false, synonyms: ["description", "particulars", "details", "item", "narration", "remarks", "note"], help: "What was bought." },
  { key: "discount", label: "Discount", required: false, synonyms: ["discount", "discount amount", "disc", "disc amount"], help: "Optional." },
  { key: "billType", label: "Bill type", required: false, synonyms: ["bill type", "tax type", "vat type", "vat", "pan", "tax"], help: "VAT, PAN, estimate, challan or no bill." },
  { key: "paid", label: "Paid amount", required: false, synonyms: ["paid", "paid amount", "amount paid", "payment", "cash paid", "settled"], help: "How much has been paid for the bill." },
  { key: "account", label: "Paid from", required: false, synonyms: ["paid from", "payment account", "paid through", "bank", "cash/bank", "cash bank", "payment mode", "mode"], help: "The cash or bank account name." },
];

export type PurchaseColumnMapping = Partial<Record<PurchaseFieldKey, string>>;

export const suggestPurchaseMapping = (headers: string[]): PurchaseColumnMapping => suggestMappingFrom(PURCHASE_FIELDS, headers);

export const purchaseMappingComplete = (m: PurchaseColumnMapping) => PURCHASE_FIELDS.filter((f) => f.required).every((f) => Boolean(m[f.key]));
