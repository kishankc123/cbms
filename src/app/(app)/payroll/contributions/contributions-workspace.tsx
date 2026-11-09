"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, controlClass } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { D } from "@/components/calendar/date-text";
import { DatePicker } from "@/components/calendar/date-picker";
import { PaymentModeSelect } from "@/components/payment-mode-select";
import { methodForMode } from "@/lib/payment-mode-rules";
import { todayIso } from "@/lib/calendar";
import { RETIREMENT_ACCOUNTS } from "@/lib/payroll/retirement-pay";
import type { RetirementAccountKey } from "@/lib/payroll/retirement-pay";
import { AmountInput } from "@/components/ui/amount-input";
const accountLabel = (k: RetirementAccountKey) => RETIREMENT_ACCOUNTS[k];
import { payContributions, type ContributionsData } from "./actions";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ContributionsWorkspace({ data }: { data: ContributionsData }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const ask = useConfirm();
  const toast = useToast();
  const [paying, setPaying] = useState<ContributionsData["funds"][number] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayIso());
  const [modeId, setModeId] = useState("");
  const [modeName, setModeName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [cheque, setCheque] = useState("");
  const [busy, setBusy] = useState(false);
  const method = modeName ? methodForMode(modeName) : "bank_transfer";

  const owedBy = (f: ContributionsData["funds"][number]) => Math.round(f.accounts.reduce((s, a) => s + Math.max(a.owed, 0), 0) * 100) / 100;

  function open(f: ContributionsData["funds"][number]) {
    setPaying(f);
    setAmounts(Object.fromEntries(f.accounts.map((a) => [a.key, a.owed > 0 ? a.owed.toFixed(2) : ""])));
    setDate(todayIso());
    setReference("");
    setCheque("");
  }

  const total = paying ? Math.round(paying.accounts.reduce((s, a) => s + (Number(amounts[a.key]) || 0), 0) * 100) / 100 : 0;

  async function submit(confirmDuplicate = false) {
    if (!paying) return;
    if (!confirmDuplicate && !(await ask(`Pay ${money(total)} to ${paying.name} from the chosen account on ${date}? This records a payment and clears what payroll owes.`, { confirmLabel: "Record payment" }))) return;
    setBusy(true);
    try {
      const r = await payContributions({
        fund: paying.key as "ssf" | "pf" | "cit",
        parts: paying.accounts.map((a) => ({ account: a.key as RetirementAccountKey, amount: Number(amounts[a.key]) || 0 })),
        paymentDate: date,
        accountId,
        paymentModeId: modeId || null,
        paymentMethod: method,
        referenceNumber: reference,
        chequeNumber: cheque || undefined,
        confirmDuplicate,
      });
      if (r.duplicateWarning) {
        setBusy(false);
        if (await ask("A very similar payment was recorded recently. Record this one anyway?", { confirmLabel: "Record anyway" })) return submit(true);
        return;
      }
      toast.success(`Payment ${r.paymentNumber} recorded`);
      setPaying(null);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Could not record the payment", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-2">Each time a payroll run is finalized, the contributions taken from employees and the employer&apos;s share are owed to the funds. Pay them here, and the amounts owed fall. SSF is one payment: the employee share, the employer share and gratuity.</p>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.funds.map((f) => {
          const owed = owedBy(f);
          return (
            <div key={f.key} className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{f.name}</h3>
                {owed > 0 ? <StatusPill tone="action">To pay</StatusPill> : <StatusPill tone="success">Nothing owed</StatusPill>}
              </div>
              <p className="text-2xl font-semibold tabular-nums text-ink">{money(owed)}</p>
              <div className="space-y-1">
                {f.accounts.map((a) => (
                  <div key={a.key} className="flex justify-between text-[13px]">
                    <span className="text-ink-2">{accountLabel(a.key as RetirementAccountKey)}</span>
                    <span className="tabular-nums text-ink">{money(a.owed)}</span>
                  </div>
                ))}
              </div>
              <Button variant="primary" onClick={() => open(f)} disabled={owed <= 0}>
                Pay {f.key.toUpperCase()}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Recent payments</h3>
        <table className="w-full border-collapse text-[13px]">
          <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Date</th>
              <th className="px-2.5 py-1.5 font-medium">Payment</th>
              <th className="px-2.5 py-1.5 font-medium">Paid to</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Amount</th>
              <th className="px-2.5 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((p) => (
              <tr key={p.id} className="border-b border-line transition-colors hover:bg-hover">
                <td className="px-2.5 py-1.5"><D value={p.date} /></td>
                <td className="px-2.5 py-1.5">
                  <Link href="/payments" className="text-accent hover:underline">{p.number}</Link>
                </td>
                <td className="px-2.5 py-1.5">{p.payee ?? "—"}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{money(Number(p.amount))}</td>
                <td className="px-2.5 py-1.5">{p.status === "voided" ? <StatusPill tone="critical">Voided</StatusPill> : <StatusPill tone="success">Paid</StatusPill>}</td>
              </tr>
            ))}
            {data.recent.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-3">
                  No contribution payments yet. To correct one, void it from Payments and record it again.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paying && (
        <Modal
          title={`Pay ${paying.name}`}
          onClose={() => setPaying(null)}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setPaying(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => submit()} loading={busy} disabled={!(total > 0) || !accountId || !date}>
                Record payment
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="space-y-2 rounded border border-line p-3">
              {paying.accounts.map((a) => (
                <Field key={a.key} label={`${accountLabel(a.key as RetirementAccountKey)} (owed ${money(a.owed)})`}>
                  <AmountInput type="number" step="0.01" min="0" max={a.owed > 0 ? a.owed : 0} disabled={a.owed <= 0} value={amounts[a.key] ?? ""} onChange={(e) => setAmounts({ ...amounts, [a.key]: e.target.value })} />
                </Field>
              ))}
              <p className="text-sm text-ink">Total paying: <span className="font-semibold tabular-nums">{money(total)}</span></p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <DatePicker value={date} onChange={setDate} className={controlClass} />
              </Field>
              <Field label="Paid from (mode and account)" required>
                <PaymentModeSelect
                  value={{ modeId, accountId, modeName }}
                  onChange={(v) => {
                    setModeId(v.modeId);
                    setModeName(v.modeName ?? "");
                    setAccountId(v.accountId);
                  }}
                  className={controlClass}
                />
              </Field>
              {method === "cheque" && (
                <Field label="Cheque number" required>
                  <Input value={cheque} onChange={(e) => setCheque(e.target.value)} />
                </Field>
              )}
              <Field label="Payment reference" className={method === "cheque" ? "" : "col-span-2"} hint="The voucher or receipt number from the fund.">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
          </div>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
