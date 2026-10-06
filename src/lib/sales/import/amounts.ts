// The money of an imported row. Pure: no database. The VAT rules mirror the Multi-Invoice writer exactly (VAT on the
// amount after discount, at the rate for the row's own date, never on a zero-rated bill), so a preview here and the invoice
// that gets posted always agree.

const round2 = (n: number) => Math.round(n * 100) / 100;

export function rowTotals(gross: number, discount: number, billType: "taxable" | "zero_rated", vatRate: number) {
  const subtotal = round2(gross - discount);
  const tax = billType === "taxable" ? round2(subtotal * (vatRate / 100)) : 0;
  return { gross: round2(gross), discount: round2(discount), subtotal, tax, total: round2(subtotal + tax) };
}

/**
 * For a file whose amounts already include VAT: the amount before VAT that gives back exactly the file's total when VAT is
 * added the way an invoice adds it. Rounding can leave a cent either way, so the nearest neighbours are tried.
 */
export function netFromInclusive(total: number, vatRate: number): number {
  if (vatRate <= 0) return round2(total);
  const guess = round2(total / (1 + vatRate / 100));
  for (const delta of [0, -0.01, 0.01, -0.02, 0.02]) {
    const net = round2(guess + delta);
    if (round2(net + round2(net * (vatRate / 100))) === round2(total)) return net;
  }
  return guess;
}
