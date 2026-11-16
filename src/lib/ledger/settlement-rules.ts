// Settling a payment through a ledger account (a director who paid a bill, an owner's capital, a receivable netted off) instead of cash or bank.
// Which accounts may be used, and how an import cell such as "Director: Sudip KC" is read. Plain functions, no database, so they can be tested.

export type LedgerAccount = { id: string; code: string; name: string; category: string; parentId: string | null };
export type SettlementAccount = { id: string; code: string; name: string; /** the group it sits under, if any */ group: string | null; groupCode: string | null };

// Accounts the app keeps up to date itself, so a payment must not move them: stock, fixed assets, VAT and other taxes, TDS and payroll. Their sub-accounts are out too.
const APP_MANAGED_GROUPS = new Set(["1200", "1210", "1300", "1500", "2090", "2100", "2300", "2310", "2320", "2340", "2350", "2360"]);

/**
 * The accounts a payment can be settled through: the lowest level of the chart (never a group that has sub-groups), an asset, a liability or equity (never
 * income or an expense), active, not pointed at by an account role, and not one of the accounts the app maintains by itself. Equity may be used even where
 * it is a main account (the owner's capital paid a bill). Customer and supplier accounts are allowed, which is what lets a receivable be netted off a payable.
 */
export function settlementAccounts(accounts: (LedgerAccount & { isActive: boolean })[], roleAccountIds: ReadonlySet<string>, systemCodes: ReadonlySet<string>): SettlementAccount[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const hasChildren = new Set(accounts.filter((a) => a.parentId).map((a) => a.parentId as string));
  const out: SettlementAccount[] = [];
  for (const a of accounts) {
    if (!a.isActive || hasChildren.has(a.id) || roleAccountIds.has(a.id)) continue;
    if (a.category !== "asset" && a.category !== "liability" && a.category !== "equity") continue;
    const group = a.parentId ? byId.get(a.parentId) ?? null : null;
    if (a.category !== "equity" && ((!group && systemCodes.has(a.code)) || APP_MANAGED_GROUPS.has(group?.code ?? a.code))) continue;
    out.push({ id: a.id, code: a.code, name: a.name, group: group?.name ?? null, groupCode: group?.code ?? null });
  }
  return out.sort((x, y) => x.code.localeCompare(y.code));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** How a ledger account is written in a cell, and in an error that has to name it: "Director: Sudip KC", or just the name when it has no group. */
export const ledgerLabel = (a: Pick<SettlementAccount, "name" | "group">) => (a.group ? `${a.group}: ${a.name}` : a.name);

/**
 * The account an import cell means. "Group: Name" (a ">" works too) names the group and the account; a bare name or a code names the account alone.
 * One match is the answer, several are "ambiguous" (listed as "Group: Name", so the file can be corrected), none is null.
 */
export function matchLedgerAccount(text: string, list: SettlementAccount[]): SettlementAccount | { ambiguous: string[] } | null {
  const split = text.split(/\s*[:>]\s*/);
  const wanted = split.length >= 2 ? { group: norm(split[0]), name: norm(split.slice(1).join(":")) } : null;
  const found = wanted
    ? list.filter((a) => norm(a.name) === wanted.name && (norm(a.group ?? "") === wanted.group || norm(a.groupCode ?? "") === wanted.group))
    : list.filter((a) => norm(a.name) === norm(text) || norm(a.code) === norm(text));
  if (found.length === 1) return found[0];
  return found.length > 1 ? { ambiguous: found.map(ledgerLabel) } : null;
}

/** The rows of the "Ledger accounts" sheet in an import template: how each account is written in a cell. */
export const ledgerSheet = (list: SettlementAccount[]) => [["Ledger accounts a payment can be settled through (write as Group: Account name)"], ...list.map((a) => [ledgerLabel(a)])];
