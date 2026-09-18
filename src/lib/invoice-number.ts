export const INVOICE_NUMBER_FORMATS = [
  { value: "prefix-number-suffix", label: "Prefix / Number / Suffix" },
  { value: "prefix-suffix-number", label: "Prefix / Suffix / Number" },
  { value: "number-prefix-suffix", label: "Number / Prefix / Suffix" },
  { value: "number-suffix-prefix", label: "Number / Suffix / Prefix" },
  { value: "suffix-prefix-number", label: "Suffix / Prefix / Number" },
  { value: "suffix-number-prefix", label: "Suffix / Number / Prefix" },
] as const;

export type InvoiceNumberFormat = (typeof INVOICE_NUMBER_FORMATS)[number]["value"];

/** Builds an invoice number like "INV/0004/26" from its configured parts. */
export function buildInvoiceNumber(
  prefix: string | null | undefined,
  suffix: string | null | undefined,
  sequence: number,
  format: string
): string {
  const parts: Record<"prefix" | "number" | "suffix", string> = {
    prefix: prefix?.trim() ?? "",
    number: String(sequence).padStart(4, "0"),
    suffix: suffix?.trim() ?? "",
  };

  const order = (format.split("-") as ("prefix" | "number" | "suffix")[]).filter(
    (k): k is "prefix" | "number" | "suffix" => k === "prefix" || k === "number" || k === "suffix"
  );
  const keys = order.length === 3 ? order : (["prefix", "number", "suffix"] as const);

  return keys
    .map((k) => parts[k])
    .filter(Boolean)
    .join("/");
}
