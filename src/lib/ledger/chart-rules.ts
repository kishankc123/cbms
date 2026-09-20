// Pure rules for the Chart of Accounts — no database — so they are unit-tested.

/**
 * Accounts other parts of the system look up BY CODE (control accounts). They can
 * be renamed, but never deleted, deactivated or moved to another category, or the
 * postings that rely on them would start failing.
 */
export const SYSTEM_ACCOUNT_CODES = new Set([
  "1000", "1010", "1100", "1200", "1300", "1350", // cash, bank, receivable, inventory, input VAT, supplier advances
  "2000", "2090", "2100", "2200", "2300", "2310", "2320", "2340", "2350", // payables, taxes payable, VAT, loans, payroll, TDS, advances
  "3000", "3050", "3100", "3200", // capital, drawings, retained earnings, brought forward
  "4000", "4100", // sales, other income
  "5000", "5200", "5900", "5910", // COGS, salaries, miscellaneous, tax fines & penalties
]);

/** A top-level control account, or one an account role points at, is a system account. */
export function isSystemAccount(account: { code: string; parentAccountId: string | null; id: string }, roleAccountIds: ReadonlySet<string>): boolean {
  return roleAccountIds.has(account.id) || (account.parentAccountId === null && SYSTEM_ACCOUNT_CODES.has(account.code));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The next free sub-account code under `parentCode`: one more than the HIGHEST
 * existing sequence. (Counting siblings instead reuses a code once any sibling has
 * been deleted.)
 */
export function nextChildCode(existingCodes: readonly string[], parentCode: string): string {
  const re = new RegExp(`^${escapeRegExp(parentCode)}\\.(\\d+)$`);
  let max = 0;
  for (const code of existingCodes) {
    const m = re.exec(code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${parentCode}.${String(max + 1).padStart(2, "0")}`;
}

/** Top-level account codes: letters/digits with optional dashes. A dot is reserved for sub-accounts. */
export function validateTopLevelCode(code: string): string | null {
  if (!code) return "Code is required";
  if (code.length > 20) return "Code can be at most 20 characters";
  if (code.includes(".")) return "A group code can't contain a dot — dots are used for sub-groups";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(code)) return "Use only letters, digits and dashes in the code";
  return null;
}

export type AccountNode = { id: string; parentAccountId: string | null };

/** Every account below `id` in the hierarchy (children, grandchildren, ...). */
export function descendantIds(all: readonly AccountNode[], id: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const a of all) {
    if (a.parentAccountId) childrenOf.set(a.parentAccountId, [...(childrenOf.get(a.parentAccountId) ?? []), a.id]);
  }
  const out: string[] = [];
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    out.push(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return out;
}

/**
 * Own balance per account (already signed to its normal side) rolled up the
 * hierarchy: each account's `total` includes everything beneath it.
 */
export function rollUpBalances(accounts: readonly (AccountNode & { own: number })[]): Map<string, { own: number; total: number }> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const result = new Map<string, { own: number; total: number }>(accounts.map((a) => [a.id, { own: a.own, total: a.own }]));
  for (const a of accounts) {
    // Walk up the chain (guarding against a cycle) adding this account's own balance to each ancestor.
    let parent = a.parentAccountId;
    const seen = new Set<string>([a.id]);
    while (parent && byId.has(parent) && !seen.has(parent)) {
      result.get(parent)!.total += a.own;
      seen.add(parent);
      parent = byId.get(parent)!.parentAccountId;
    }
  }
  for (const v of result.values()) {
    v.own = Math.round(v.own * 100) / 100;
    v.total = Math.round(v.total * 100) / 100;
  }
  return result;
}
