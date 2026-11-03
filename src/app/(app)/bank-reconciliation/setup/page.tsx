import { guardView } from "@/components/page-guard";
import { listBankAccounts, getBankAccountLedgerOptions } from "../actions";
import { BankAccountsTable } from "./bank-accounts-table";

export default async function BankAccountSetupPage() {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const [bankAccounts, ledgerOptions] = await Promise.all([listBankAccounts(), getBankAccountLedgerOptions()]);

  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-ink">Bank Accounts</h1>
      <BankAccountsTable bankAccounts={bankAccounts} ledgerOptions={ledgerOptions} />
    </div>
  );
}
