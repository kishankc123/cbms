// The columns Import Sales understands, and how a file's headers are matched to them. Pure: no database.

export type ImportFieldKey = "date" | "customer" | "amount" | "discount" | "billType" | "paid" | "account";

export type ImportField = {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  /** Header names that mean this column, best first. */
  synonyms: string[];
  help: string;
};

export const IMPORT_FIELDS: ImportField[] = [
  { key: "date", label: "Date", required: true, synonyms: ["date", "invoice date", "bill date", "sales date", "sale date", "txn date", "transaction date", "miti", "मिति"], help: "AD or BS dates both work." },
  { key: "amount", label: "Amount", required: true, synonyms: ["amount", "sales amount", "sale amount", "taxable amount", "net amount", "basic amount", "invoice amount", "bill amount", "value", "sales", "total"], help: "The invoice amount, before VAT unless you say it includes VAT." },
  { key: "customer", label: "Customer", required: false, synonyms: ["customer", "customer name", "party", "party name", "client", "client name", "buyer", "sold to", "name"], help: "Leave blank for cash sales that are paid in full." },
  { key: "discount", label: "Discount", required: false, synonyms: ["discount", "discount amount", "disc", "disc amount"], help: "Optional." },
  { key: "billType", label: "Bill type", required: false, synonyms: ["bill type", "tax type", "vat type", "vat", "taxable", "tax"], help: "Taxable or zero-rated." },
  { key: "paid", label: "Paid amount", required: false, synonyms: ["paid", "paid amount", "amount paid", "received", "amount received", "received amount", "collected", "payment", "receipt"], help: "How much has been received for the invoice." },
  { key: "account", label: "Received into", required: false, synonyms: ["received into", "payment account", "deposit account", "account", "bank", "cash/bank", "cash bank", "payment mode", "mode"], help: "The cash or bank account name." },
];

export type SalesColumnMapping = Partial<Record<ImportFieldKey, string>>;

export type FieldDef<K extends string> = { key: K; label: string; required: boolean; synonyms: string[]; help: string };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Suggests which header holds each field. An exact match on a known name wins; otherwise a header that contains the name
 * (so "Invoice Date (AD)" still finds Date). A header is used for at most one field, and a header that says "amount" is
 * never taken for the bill type (that would be "VAT Amount").
 */
export function suggestMapping(headers: string[]): SalesColumnMapping {
  return suggestMappingFrom(IMPORT_FIELDS, headers);
}

/** The same matching for any list of fields (Import Purchases has its own columns). */
export function suggestMappingFrom<K extends string>(fields: FieldDef<K>[], headers: string[]): Partial<Record<K, string>> {
  const cleaned = headers.map((h) => ({ raw: h, n: norm(h) })).filter((h) => h.n !== "");
  const used = new Set<string>();
  const mapping: Partial<Record<K, string>> = {};

  const pick = (field: FieldDef<K>, test: (header: string, synonym: string) => boolean) => {
    if (mapping[field.key]) return;
    for (const syn of field.synonyms) {
      const hit = cleaned.find((h) => !used.has(h.raw) && test(h.n, norm(syn)) && !(field.key === "billType" && /amount/.test(h.n)));
      if (hit) {
        mapping[field.key] = hit.raw;
        used.add(hit.raw);
        return;
      }
    }
  };

  // Exact matches for every field first, so a loose match never steals a header another field matches exactly.
  for (const f of fields) pick(f, (h, s) => h === s);
  for (const f of fields) pick(f, (h, s) => s.length >= 4 && (h.includes(s) || h.startsWith(s)));
  return mapping;
}

/** True when every required field has a header. */
export const mappingComplete = (m: SalesColumnMapping) => IMPORT_FIELDS.filter((f) => f.required).every((f) => Boolean(m[f.key]));

/** A stable fingerprint of a file's headers, so a layout seen before finds its remembered mapping. */
export function headerSignature(headers: string[]): string {
  const text = headers.map(norm).filter(Boolean).sort().join("|");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${text.length}`;
}
