import Link from "next/link";
import { guardView } from "@/components/page-guard";
import { getReconciliationOverview } from "./actions";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { AccountsList } from "./accounts-list";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function BankReconciliationHome() {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const accounts = await getReconciliationOverview();
  const banks = accounts.filter((a) => a.kind === "bank").length;
  const wallets = accounts.length - banks;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bank Reconciliation"
        description={
          accounts.length > 0
            ? `You have ${plural(banks, "bank account", "bank accounts")}${wallets > 0 ? ` and ${plural(wallets, "cash or wallet account", "cash or wallet accounts")}` : ""}.`
            : "Match your bank statements with your books."
        }
        className="!mb-0"
        primary={
          <Link href="/bank-reconciliation/setup" className={buttonClass({ variant: "primary" })}>
            + Add new account
          </Link>
        }
      />
      <AccountsList accounts={accounts} />
    </div>
  );
}
