// Reading a purchase file's bill type cell. Pure: no database. (Money, names and dates are read by the Import Sales helpers.)

export type PurchaseBillTypeValue = "vat" | "pan" | "estimate" | "challan" | "no_bill";

const MAP: [PurchaseBillTypeValue, string[]][] = [
  ["vat", ["vat", "vat bill", "taxable", "tax", "with vat", "13", "13%", "vatable"]],
  ["pan", ["pan", "pan bill", "pan no", "with pan"]],
  ["estimate", ["estimate", "estimated", "quotation"]],
  ["challan", ["challan", "chalan", "delivery challan"]],
  ["no_bill", ["no bill", "nobill", "no_bill", "none", "without bill", "cash", "no", "n/a", "na", "-"]],
];

/** undefined = the cell is blank (use the default), null = something there isn't a bill type. */
export function parsePurchaseBillType(cell: string | undefined | null): PurchaseBillTypeValue | undefined | null {
  const t = (cell ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (t === "") return undefined;
  for (const [type, names] of MAP) if (names.some((n) => n.replace(/[_-]+/g, " ") === t)) return type;
  return null;
}

export const BILL_TYPE_LABEL: Record<PurchaseBillTypeValue, string> = { vat: "VAT", pan: "PAN", estimate: "Estimate", challan: "Challan", no_bill: "No bill" };
