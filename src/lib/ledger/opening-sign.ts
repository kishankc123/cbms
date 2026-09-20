/**
 * The stored sign of a party's opening balance, from the amount and the Dr/Cr the user picked.
 *
 * Both are stored so that POSITIVE means the balance is on the party's normal side:
 *  - customer (receivable, debit-normal):  Dr = positive, Cr = negative
 *  - supplier (payable, credit-normal):    Cr = positive, Dr = negative
 */
export function signedOpeningBalance(party: "customer" | "supplier", amount: number, side: "DR" | "CR"): number {
  const abs = Math.abs(amount) || 0;
  const normalSide = party === "customer" ? "DR" : "CR";
  if (abs === 0) return 0;
  return side === normalSide ? abs : -abs;
}

/** The Dr/Cr label for a stored opening balance (the inverse of the above). */
export function openingSide(party: "customer" | "supplier", stored: number): "DR" | "CR" {
  const normalSide = party === "customer" ? "DR" : "CR";
  const other = normalSide === "DR" ? "CR" : "DR";
  return stored < 0 ? other : normalSide;
}
