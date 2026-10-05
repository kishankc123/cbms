// What leaves the books when an asset is sold, disposed of or written off, with no database.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type DisposalKind = "sale" | "disposal" | "write_off";

export function disposalAmounts({ cost, accumulated, proceeds, vatRate }: { cost: number; accumulated: number; proceeds: number; vatRate: number }) {
  const netBookValue = round2(cost - accumulated);
  const vat = round2(proceeds * (vatRate / 100));
  const total = round2(proceeds + vat);
  /** Positive is a gain on disposal, negative a loss. */
  const gainLoss = round2(proceeds - netBookValue);
  return { netBookValue, vat, total, gainLoss };
}

/** The first problem with a disposal's figures, or null when sound. */
export function checkDisposal(i: { kind: DisposalKind; proceeds: number; reason: string; receivedAccountId: string | null }): string | null {
  if (i.kind === "sale") {
    if (!(i.proceeds > 0)) return "Enter the sale price.";
    if (!i.receivedAccountId) return "Choose the cash or bank account the money was received into.";
  } else if (!i.reason.trim()) {
    return i.kind === "write_off" ? "Enter the reason for the write-off." : "Enter the reason for the disposal.";
  }
  return null;
}
