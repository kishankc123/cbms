import type { PostLineInput } from "./post";

// Pure rules of the Opening balances screen (unit tested). Every amount is a net debit: a debit is positive, a credit negative.
// Stock and fixed assets are worked out from item and asset records, so a typed figure would put the ledger out of step with the stock
// and asset registers. They are listed, and entered on their own screens.
const OWN_SCREENS: [string, string][] = [["1200", "/inventory/stock"], ["1500", "/assets"], ["1590", "/assets"]];
export const otherScreenFor = (code: string) => OWN_SCREENS.find(([p]) => code === p || code.startsWith(`${p}.`))?.[1] ?? null;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Debit and credit totals of a list of net debits. */
export const sheetTotals = (nets: number[]) => ({
  debit: round2(nets.filter((n) => n > 0).reduce((s, n) => s + n, 0)),
  credit: round2(-nets.filter((n) => n < 0).reduce((s, n) => s + n, 0)),
});

/** The lines of the one entry: each typed account, then one balancing line to Brought forward so it always balances. */
export function buildOpeningLines(typed: { accountId: string; name: string; netDebit: number }[], broughtForwardId: string): PostLineInput[] {
  const lines: PostLineInput[] = [];
  let net = 0;
  for (const t of typed) {
    const nd = round2(t.netDebit);
    if (nd === 0) continue;
    net = round2(net + nd);
    const description = `Opening balance - ${t.name}`;
    lines.push(nd > 0 ? { accountId: t.accountId, debitAmount: nd, description } : { accountId: t.accountId, creditAmount: -nd, description });
  }
  if (net !== 0) {
    const description = "Opening balance - balancing figure";
    lines.push(net > 0 ? { accountId: broughtForwardId, creditAmount: net, description } : { accountId: broughtForwardId, debitAmount: -net, description });
  }
  return lines;
}
