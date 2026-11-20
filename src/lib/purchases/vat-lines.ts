// VAT on the lines of a purchase invoice. A VAT bill can mix goods that carry VAT with zero-rated and exempt ones, so each line has a treatment; the bill
// type still decides whether VAT applies at all (a PAN, estimate or no-bill invoice carries none). Pure, so it is unit-tested.

export type LineTreatment = "taxable" | "zero_rated" | "exempt";

export const LINE_TREATMENTS: { value: LineTreatment; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "zero_rated", label: "Zero-rated" },
  { value: "exempt", label: "Exempt" },
];

export const isTreatment = (v: unknown): v is LineTreatment => v === "taxable" || v === "zero_rated" || v === "exempt";

/** The VAT rate (percent) that applies to one line: the rate for a taxable line of a VAT bill, nothing otherwise. */
export function lineVatRate(billType: string, treatment: LineTreatment | undefined | null, vatRate: number): number {
  return billType === "vat" && (treatment ?? "taxable") === "taxable" ? vatRate : 0;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The taxable value of a bill split by treatment, for the summary and the VAT return. Without a VAT bill everything is plain value. */
export function splitByTreatment(billType: string, lines: readonly { taxable: number; taxTreatment?: LineTreatment | null }[]) {
  let taxable = 0;
  let zeroRated = 0;
  let exempt = 0;
  for (const l of lines) {
    const t = billType === "vat" ? l.taxTreatment ?? "taxable" : "taxable";
    if (t === "taxable") taxable += l.taxable;
    else if (t === "zero_rated") zeroRated += l.taxable;
    else exempt += l.taxable;
  }
  return { taxable: round2(taxable), zeroRated: round2(zeroRated), exempt: round2(exempt) };
}

const TREATMENT_NAMES: [LineTreatment, string[]][] = [
  ["taxable", ["taxable", "vat", "vatable", "with vat", "13", "13%"]],
  ["zero_rated", ["zero rated", "zero", "zero rate", "0%", "0"]],
  ["exempt", ["exempt", "exempted", "vat exempt", "tax exempt"]],
];

/** Reads a file's VAT treatment cell. undefined = blank (taxable), null = something there isn't a treatment. */
export function parseTreatmentCell(cell: string | undefined | null): LineTreatment | undefined | null {
  const t = (cell ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (t === "") return undefined;
  for (const [value, names] of TREATMENT_NAMES) if (names.includes(t)) return value;
  return null;
}
