import { validateADDate } from "@/lib/calendar";

// The rules for an opening (brought-in) asset, with no database. An opening asset is NOT a purchase of the current period:
// it arrives with the cost it was bought for and the depreciation already taken, and carries on from there.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OpeningAmountsInput = { cost: number; accumulated: number; residual: number };

export function openingAssetAmounts({ cost, accumulated, residual }: OpeningAmountsInput) {
  const netBookValue = round2(cost - accumulated);
  const remainingDepreciable = Math.max(0, round2(cost - residual - accumulated));
  return { netBookValue, remainingDepreciable, fullyDepreciated: remainingDepreciable <= 0 };
}

export type OpeningAssetCheck = {
  name: string;
  originalPurchaseDate: string;
  openingDate: string;
  cost: number;
  accumulated: number;
  residual: number;
  method: "straight_line" | "declining_balance" | "none";
  originalUsefulLifeMonths: number | null;
  remainingUsefulLifeMonths: number | null;
  depreciationStartDate: string | null;
};

/** The first problem with an opening asset's figures, in the order a person fills the form in, or null when it is sound. */
export function checkOpeningAsset(i: OpeningAssetCheck): string | null {
  if (!i.name.trim()) return "Enter the asset name.";
  if (!i.originalPurchaseDate || !validateADDate(i.originalPurchaseDate)) return "Enter the original purchase date.";
  if (i.originalPurchaseDate >= i.openingDate) return "The original purchase date must be before your books start. An asset bought after that is a purchase: enter it under Purchase asset.";
  if (!(i.cost > 0)) return "Enter the original cost.";
  if (!(i.accumulated >= 0)) return "The accumulated depreciation can't be negative.";
  if (i.accumulated > i.cost + 0.004) return "The accumulated depreciation can't be more than the original cost.";
  if (!(i.residual >= 0)) return "The residual value can't be negative.";
  if (i.residual > round2(i.cost - i.accumulated) + 0.004) return "The residual value can't be more than the opening net book value.";

  const { fullyDepreciated } = openingAssetAmounts({ cost: i.cost, accumulated: i.accumulated, residual: i.residual });
  if (i.method !== "none" && !fullyDepreciated) {
    const remaining = i.remainingUsefulLifeMonths;
    if (!(Number.isInteger(remaining) && remaining! >= 1 && remaining! <= 1200)) return "Enter the remaining useful life (at least one month), because the asset isn't fully depreciated.";
    if (i.originalUsefulLifeMonths !== null && i.originalUsefulLifeMonths < remaining!) return "The remaining useful life can't be longer than the original useful life.";
    if (!i.depreciationStartDate || !validateADDate(i.depreciationStartDate)) return "Enter the date depreciation continues from.";
  }
  return null;
}
