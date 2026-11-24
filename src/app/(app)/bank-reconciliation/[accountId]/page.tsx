import { notFound, redirect } from "next/navigation";
import { guardView } from "@/components/page-guard";
import { BackButton } from "@/components/ui/back-button";
import { listBankAccounts, getOffsetAccountOptions } from "../actions";
import { ReconciliationWorkspace } from "../reconciliation-workspace";
import { reconcileMethodOf } from "@/lib/ledger/cash-reconcile-rules";

export default async function ReconcileAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const { accountId } = await params;
  const [accounts, offsetAccounts] = await Promise.all([listBankAccounts(), getOffsetAccountOptions()]);
  const account = accounts.find((b) => b.id === accountId && b.isActive);
  if (!account) notFound();
  // A bank account set to tick its entries (no statement to upload) is reconciled on the other screen.
  if (account.ledgerCode.startsWith("1010") && reconcileMethodOf(account.ledgerCode, account.reconcileMethod) === "ticking") redirect(`/bank-reconciliation/${accountId}/cash`);
  const label = `${account.bankName && account.bankName !== account.accountName ? account.bankName + " — " : ""}${account.accountName}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <BackButton href="/bank-reconciliation" label="Back to bank accounts" />
        <div>
          <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Reconciling {label}</h1>
          {account.accountNumber && <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{account.accountNumber}</p>}
        </div>
      </div>
      <ReconciliationWorkspace bankAccounts={[{ id: account.id, label }]} offsetAccounts={offsetAccounts} />
    </div>
  );
}
