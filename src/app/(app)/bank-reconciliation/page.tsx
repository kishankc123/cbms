import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { getReconciliationOverview, type AccountOverview } from "./actions";

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Where this account's bank balance stands against the books, in a sentence.
function differenceText(a: AccountOverview) {
  if (!a.updatedUpTo) return "Upload a statement to compare it with your books.";
  if (Math.abs(a.difference) < 0.005) return "The bank balance matches your books.";
  return a.difference > 0 ? "The bank balance is higher than your books." : "The bank balance is lower than your books.";
}

// The badge tells the truth about where the account stands: nothing imported, lines to match, a difference still to explain, or done.
function StatusBadge({ a }: { a: AccountOverview }) {
  if (!a.updatedUpTo) return <StatusPill tone="pending">No statement uploaded yet</StatusPill>;
  if (a.unreconciled > 0) return <StatusPill tone="action">{plural(a.unreconciled, "unreconciled transaction", "unreconciled transactions")}</StatusPill>;
  if (Math.abs(a.difference) >= 0.005) return <StatusPill tone="action">Difference to explain</StatusPill>;
  return <StatusPill tone="success">All reconciled</StatusPill>;
}

export default async function BankReconciliationHome() {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const accounts = await getReconciliationOverview();
  const banks = accounts.filter((a) => a.kind === "bank").length;
  const wallets = accounts.length - banks;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Bank Reconciliation</h1>
          {accounts.length > 0 && (
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
              You have {plural(banks, "bank account", "bank accounts")}
              {wallets > 0 ? ` and ${plural(wallets, "cash or wallet account", "cash or wallet accounts")}` : ""}.
            </p>
          )}
        </div>
        <Link href="/bank-reconciliation/setup" className="rounded border border-[var(--card-border)] px-4 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-muted-bg)]">
          + Add new account
        </Link>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-sm text-[var(--text-secondary)]">
          No active bank accounts yet.{" "}
          <Link href="/bank-reconciliation/setup" className="text-[var(--color-primary)] hover:underline">
            Set one up
          </Link>{" "}
          before reconciling.
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((a) => (
            <section key={a.id} className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge a={a} />
                  {a.flagged > 0 && <StatusPill tone="critical">{plural(a.flagged, "flagged transaction", "flagged transactions")}</StatusPill>}
                </div>
                <div className="text-right">
                  <p className="font-medium text-[var(--text-primary)]">{a.label}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {a.kind === "bank" ? "Bank" : "Cash or wallet"}
                    {a.accountNumber ? ` · ${a.accountNumber}` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Balance per bank statement</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{money(a.statementBalance, a.currency)}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{a.updatedUpTo ? <>Updated up to <D value={a.updatedUpTo} /></> : "No statement uploaded yet"}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Balance per your books</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{money(a.ledgerBalance, a.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Difference</p>
                  <p className={`text-lg font-semibold tabular-nums ${Math.abs(a.difference) < 0.005 ? "text-green-700" : "text-red-600"}`}>{money(a.difference, a.currency)}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{differenceText(a)}</p>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Link href={`/bank-reconciliation/${a.id}`} className="rounded bg-[var(--color-primary)] px-5 py-1.5 text-sm text-white hover:bg-[var(--color-primary-hover)]">
                  View
                </Link>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
