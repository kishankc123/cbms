import Link from "next/link";

/**
 * The first drill-down hop from any financial statement: REPORT → ACCOUNT. Every account amount in P&L,
 * the Balance Sheet and the Trial Balance goes through this, straight to that account's own ledger for
 * the same period — never a re-derived number, the same `generalLedger()` the Ledger report itself uses.
 */
export function AccountLink({ accountId, from, to, className, children }: { accountId: string; from?: string; to?: string; className?: string; children: React.ReactNode }) {
  const params = new URLSearchParams({ account: accountId });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return (
    <Link href={`/reports/ledger?${params.toString()}`} className={className ?? "hover:underline hover:text-[var(--color-primary)]"}>
      {children}
    </Link>
  );
}
