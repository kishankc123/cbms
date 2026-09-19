import { listBankAccounts, getBankAccountLedgerOptions } from "../actions";
import { BankAccountsTable } from "./bank-accounts-table";

export default async function BankAccountSetupPage() {
  const [bankAccounts, ledgerOptions] = await Promise.all([listBankAccounts(), getBankAccountLedgerOptions()]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Bank Accounts</h1>
      <BankAccountsTable bankAccounts={bankAccounts} ledgerOptions={ledgerOptions} />
    </div>
  );
}
