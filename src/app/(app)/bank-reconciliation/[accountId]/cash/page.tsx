import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { vendors } from "@/db/schema";
import { guardView } from "@/components/page-guard";
import { PageHeader } from "@/components/ui/page-header";
import { can, requireTenantSession } from "@/lib/session";
import { isOrgAdmin } from "@/lib/roles";
import { todayIso } from "@/lib/calendar";
import { getExpenseCategoryAccounts } from "@/lib/ledger/expense-accounts";
import { getCashBankAccounts } from "@/lib/ledger/cash-bank-accounts";
import { cashHistory, cashWorkspace, CashReconError, incomeAccountOptions } from "@/lib/ledger/cash-reconcile";
import { findShortExcessAccount } from "@/lib/ledger/cash-short-excess";
import { reconcileMethodOf } from "@/lib/ledger/cash-reconcile-rules";
import { getExpenseTaxDefaults } from "../../../expenses/actions";
import { listBankAccounts } from "../../actions";
import { CashReconciliation } from "./cash-reconciliation";
import { ChangeMethod } from "../../change-method";

export default async function CashReconciliationPage({ params }: { params: Promise<{ accountId: string }> }) {
  const denied = await guardView("bank_reconciliation");
  if (denied) return denied;
  const { accountId } = await params;
  const session = await requireTenantSession();

  const accountsList = await listBankAccounts();
  const account = accountsList.find((b) => b.id === accountId && b.isActive);
  if (!account) notFound();
  // A bank account that is reconciled against its statement has its own screen.
  if (reconcileMethodOf(account.ledgerCode, account.reconcileMethod) === "statement") redirect(`/bank-reconciliation/${accountId}`);
  const isBank = account.ledgerCode.startsWith("1010");

  let workspace: Awaited<ReturnType<typeof cashWorkspace>>;
  try {
    workspace = await cashWorkspace(session.tenantId, accountId, todayIso());
  } catch (e) {
    if (e instanceof CashReconError) return <p className="text-sm text-red-600">{e.message}</p>;
    throw e;
  }
  const history = await cashHistory(session.tenantId, accountId);

  // What the Explain screens need, only when something posted at a reconciliation is still unexplained and the person may use them.
  const canEdit = can(session, "bank_reconciliation", "edit");
  const anyOpenShort = history.some((h) => h.adjustment < 0 && h.remaining > 0);
  const anyOpenExcess = history.some((h) => h.adjustment > 0 && h.remaining > 0);
  const shortExcess = await findShortExcessAccount(session.tenantId);
  const expenseForm =
    canEdit && anyOpenShort && can(session, "expenses", "create")
      ? await Promise.all([
          db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, session.tenantId)).orderBy(asc(vendors.name)),
          getExpenseCategoryAccounts(session.tenantId),
          getCashBankAccounts(session.tenantId),
          getExpenseTaxDefaults(),
        ]).then(([vendorList, categoryAccounts, cashBankAccounts, tax]) => ({ vendors: vendorList, categoryAccounts, cashBankAccounts, vatRate: tax.vatRate }))
      : null;
  const incomeAccounts = canEdit && anyOpenExcess ? await incomeAccountOptions(session.tenantId) : [];

  const label = `${account.bankName && account.bankName !== account.accountName ? account.bankName + " — " : ""}${account.accountName}`;
  return (
    <div className="space-y-4">
      <PageHeader title={`Reconciling ${label}`} description={isBank ? "Tick the entries you have checked against your bank, then mark the closing balance as reconciled. The balance as per the bank is optional but is the proof." : "Tick the entries you have checked, then mark the closing balance as reconciled. Counting the cash is optional but is the proof."} back={{ href: "/bank-reconciliation", label: "Back to accounts" }} className="!mb-0" />
      {isBank && <ChangeMethod bankAccountId={accountId} label={label} method="ticking" className="text-xs text-accent-text hover:underline" />}
      <CashReconciliation
        bankAccountId={accountId}
        accountName={label}
        initial={workspace}
        today={todayIso()}
        history={history}
        canEdit={canEdit}
        canReopen={isOrgAdmin(session.role)}
        expenseForm={expenseForm}
        incomeAccounts={incomeAccounts}
        shortExcessName={shortExcess?.name ?? "Cash Short and Excess"}
      />
    </div>
  );
}
