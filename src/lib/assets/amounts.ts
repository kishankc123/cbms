const round2 = (n: number) => Math.round(n * 100) / 100;

export type AssetCostInput = { purchasePrice: number; freightCost: number; installationCost: number; otherCost: number };

/**
 * What a supplier invoice for an asset adds up to, and how much of it becomes the asset's cost. Used by the purchase form's
 * live preview and by the server when posting, so the two can never disagree.
 *
 *   capitalized cost = price + freight + installation + other directly attributable cost
 *                      (+ the VAT, only when it can't be claimed back)
 *
 * Recoverable input VAT stays out of the cost (it is a claim on the tax authority, booked to Tax Receivable).
 */
export function assetPurchaseAmounts(input: AssetCostInput, vatRate: number, vatClaimable: boolean) {
  const base = round2(input.purchasePrice + input.freightCost + input.installationCost + input.otherCost);
  const vat = round2(base * (vatRate / 100));
  const capitalizedCost = round2(vatClaimable ? base : base + vat);
  return { base, vat, capitalizedCost, total: round2(base + vat) };
}
