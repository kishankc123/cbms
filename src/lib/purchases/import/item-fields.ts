import type { FieldDef } from "@/lib/import-columns";

// The columns of the item purchase file: one row per item line. Lines with the same supplier and invoice number are one bill.

export type ItemFieldKey = "date" | "supplier" | "invoiceNumber" | "billType" | "item" | "quantity" | "rate" | "discount" | "vat" | "paid" | "account";

export const ITEM_FIELDS: FieldDef<ItemFieldKey>[] = [
  { key: "date", label: "Date", required: true, help: "dd/mm/yyyy, in AD or BS." },
  { key: "supplier", label: "Supplier", required: false, help: "Leave blank for a purchase paid in full to no one in particular. A new name is created if you allow it." },
  { key: "invoiceNumber", label: "Invoice no.", required: true, help: "The supplier's invoice number. Lines with the same supplier and number are one bill." },
  { key: "billType", label: "Bill type", required: false, help: "VAT, PAN, estimate, challan or no bill. Blank uses the default you choose." },
  { key: "item", label: "Item", required: true, help: "The name of a stock item, as it is in Inventory." },
  { key: "quantity", label: "Quantity", required: true, help: "How many were bought." },
  { key: "rate", label: "Rate", required: true, help: "The price of one, before VAT." },
  { key: "discount", label: "Discount", required: false, help: "The discount on this line, as an amount." },
  { key: "vat", label: "VAT treatment", required: false, help: "Taxable, zero-rated or exempt, for a VAT bill. Blank is taxable, or what the item is set to." },
  { key: "paid", label: "Paid", required: false, help: "How much of the bill was paid. Put it on any line of the bill; blank means not paid." },
  { key: "account", label: "Account", required: false, help: "The cash or bank account it was paid from. Blank uses the default you choose." },
];
