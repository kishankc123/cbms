import Link from "next/link";
import { listBankAccounts, getOffsetAccountOptions } from "./actions";
import { ReconciliationWorkspace } from "./reconciliation-workspace";

export default async function BankReconciliationPage() {
  const [bankAccounts, offsetAccounts] = await Promise.all([listBankAccounts(), getOffsetAccountOptions()]);
  const activeBankAccounts = bankAccounts.filter((b) => b.isActive);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Bank Reconciliation</h1>

      {activeBankAccounts.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
          No active bank accounts yet.{" "}
          <Link href="/bank-reconciliation/setup" className="text-[var(--color-primary)] hover:underline">
            Set one up
          </Link>{" "}
          before reconciling.
        </div>
      ) : (
        <ReconciliationWorkspace
          bankAccounts={activeBankAccounts.map((b) => ({
            id: b.id,
            label: `${b.bankName ? b.bankName + " — " : ""}${b.accountName}${b.accountNumber ? " — " + b.accountNumber : ""}`,
          }))}
          offsetAccounts={offsetAccounts}
        />
      )}
    </div>
  );
}
