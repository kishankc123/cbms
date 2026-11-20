// Adding the items to a purchase that was recorded by amount. If its VAT return has been filed, the bill's value and VAT are final: the items only decide
// how those fixed figures are split. A small difference is rounding and is absorbed; a larger one is refused after filing, and confirmed by the person before it.

/** How far the items may be from the recorded bill, per figure, and still count as the same bill (rounding). */
export const DETAILS_TOLERANCE = 1;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type DetailsDecision =
  /** The items add up to the bill exactly: post them as entered. */
  | { mode: "as_entered" }
  /** Within the tolerance: the bill's recorded figures stand, the items are shares of them. */
  | { mode: "fixed" }
  /** Further off, and not filed: the person may confirm the recorded amount was wrong. */
  | { mode: "confirm"; message: string }
  /** Further off, and filed: refused. */
  | { mode: "refused"; message: string };

type Figures = { subtotal: number; tax: number; total: number };
const f = (n: number) => n.toFixed(2);

export function decideDetails(input: { recorded: Figures; items: Figures; filed: boolean; tolerance?: number }): DetailsDecision {
  const tol = input.tolerance ?? DETAILS_TOLERANCE;
  const dSub = round2(input.items.subtotal - input.recorded.subtotal);
  const dTax = round2(input.items.tax - input.recorded.tax);
  if (Math.abs(dSub) < 0.005 && Math.abs(dTax) < 0.005) return { mode: "as_entered" };
  if (Math.abs(dSub) <= tol + 0.0001 && Math.abs(dTax) <= tol + 0.0001) return { mode: "fixed" };
  const off =
    Math.abs(dSub) > tol
      ? `${f(Math.abs(dSub))} ${dSub > 0 ? "more" : "less"} than the bill's value of ${f(input.recorded.subtotal)}`
      : `${f(Math.abs(dTax))} ${dTax > 0 ? "more" : "less"} VAT than the bill's ${f(input.recorded.tax)}`;
  if (input.filed) {
    return { mode: "refused", message: `These items are ${off}. The VAT return for this bill has been filed, so its value and VAT can't change. Correct the items so they match the bill, or ask an administrator to reopen the filing.` };
  }
  return { mode: "confirm", message: `The items add up to ${f(input.items.total)}, but this bill was recorded as ${f(input.recorded.total)}. Make the items add up to the bill, or confirm that the recorded amount was wrong.` };
}
