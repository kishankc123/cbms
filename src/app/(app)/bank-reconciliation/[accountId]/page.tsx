import { notFound } from "next/navigation";
import { guardView } from "@/components/page-guard";
import { BackButton } from "@/components/ui/back-button";
import { listBankAccounts, getOffsetAccountOptions } from "../actions";
import { ReconciliationWorkspace } from "../reconciliation-workspace";

export default async function ReconcileAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const { accountId } = await params;
  const [accounts, offsetAccounts] = await Promise.all([listBankAccounts(), getOffsetAccountOptions()]);
  const account = accounts.find((b) => b.id === accountId && b.isActive);
  if (!account) notFound();
  const label = `${account.bankName && account.bankName !== account.accountName ? account.bankName + " — " : ""}${account.accountName}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <BackButton href="/bank-reconciliation" label="Back to bank accounts" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Reconciling {label}</h1>
          {account.accountNumber && <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{account.accountNumber}</p>}
        </div>
      </div>
      <ReconciliationWorkspace bankAccounts={[{ id: account.id, label }]} offsetAccounts={offsetAccounts} />
    </div>
  );
}
