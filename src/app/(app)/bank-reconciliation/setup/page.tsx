import { guardView } from "@/components/page-guard";
import { listBankAccounts, getBankAccountLedgerOptions, getBankFormOptions } from "../actions";
import { BankAccountsTable } from "./bank-accounts-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function BankAccountSetupPage() {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const [bankAccounts, ledgerOptions, options] = await Promise.all([listBankAccounts(), getBankAccountLedgerOptions(), getBankFormOptions()]);

  return (
    <div className="space-y-6">
      <PageHeader title="Bank Accounts" className="!mb-0" />
      <BankAccountsTable bankAccounts={bankAccounts} ledgerOptions={ledgerOptions} options={options} />
    </div>
  );
}
