// Pure ownership arithmetic — no database — so the rules that matter (percentages,
// unallocated shares, unpaid amounts, what a transfer moves) are unit-tested.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CapitalInput = { authorisedCapital: number; issuedShares: number; faceValue: number };
export type HolderInput = { id: string; name: string; shares: number; paid: number; active: boolean };

export function ownershipPct(shares: number, issuedShares: number): number {
  return issuedShares > 0 ? round2((shares / issuedShares) * 100) : 0;
}

export function summarizeOwnership(cap: CapitalInput, holders: HolderInput[]) {
  const active = holders.filter((h) => h.active);
  const allocatedShares = active.reduce((s, h) => s + h.shares, 0);
  const issuedCapital = round2(cap.issuedShares * cap.faceValue);
  return {
    issuedCapital,
    allocatedShares,
    unallocatedShares: cap.issuedShares - allocatedShares,
    /** Percentage of issued shares assigned to shareholders (100 when complete). */
    allocationPct: ownershipPct(allocatedShares, cap.issuedShares),
    exceedsAuthorised: cap.authorisedCapital > 0 && issuedCapital > cap.authorisedCapital + 0.005,
    holders: holders.map((h) => {
      const subscribed = round2(h.shares * cap.faceValue);
      return { ...h, ownershipPct: ownershipPct(h.shares, cap.issuedShares), subscribed, unpaid: Math.max(round2(subscribed - h.paid), 0) };
    }),
  };
}

/** Would issuing `newShares` more keep issued capital within the authorised capital? */
export function withinAuthorised(cap: CapitalInput, newShares: number): boolean {
  return cap.authorisedCapital <= 0 || (cap.issuedShares + newShares) * cap.faceValue <= cap.authorisedCapital + 0.005;
}

/**
 * When shares move between holders, the paid-up capital attributed to them moves
 * with them: by default in proportion to the shares transferred.
 */
export function proportionalPaid(holder: { shares: number; paid: number }, sharesTransferred: number): number {
  if (holder.shares <= 0 || sharesTransferred <= 0) return 0;
  return round2(Math.min(holder.paid, (holder.paid * sharesTransferred) / holder.shares));
}
