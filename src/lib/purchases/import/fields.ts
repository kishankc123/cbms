import type { ColumnMapping, FieldDef } from "@/lib/import-columns";
import { payFields, type PayKey } from "@/lib/import-payments";

// The columns Import Purchases understands (one row = one consumable bill).

export type PurchaseFieldKey = "date" | "amount" | "supplier" | "category" | "billNumber" | "description" | "discount" | "billType" | PayKey;

export const PURCHASE_FIELDS: FieldDef<PurchaseFieldKey>[] = [
  { key: "date", label: "Date", required: true, help: "dd/mm/yyyy, in AD or BS." },
  { key: "amount", label: "Amount", required: true, help: "The bill amount, before VAT unless you say it includes VAT." },
  { key: "supplier", label: "Supplier", required: false, help: "Leave blank for a purchase paid in full to no one in particular." },
  { key: "category", label: "Category", required: false, help: "The purchase category it is booked to." },
  { key: "billNumber", label: "Bill number", required: false, help: "The supplier's own number. Blank gets an automatic one." },
  { key: "description", label: "Description", required: false, help: "What was bought." },
  { key: "discount", label: "Discount", required: false, help: "Optional." },
  { key: "billType", label: "Bill type", required: false, help: "VAT, PAN, estimate, challan or no bill." },
  ...payFields("Paid from", "How much has been paid.", "The cash or bank account name."),
];

export type PurchaseColumnMapping = ColumnMapping<PurchaseFieldKey>;
