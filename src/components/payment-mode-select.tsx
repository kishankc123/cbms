"use client";

import { useEffect, useState } from "react";
import { getLedgerOptions, getPaymentModeOptions } from "@/app/(app)/payment-mode-actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ledgerLabel } from "@/lib/ledger/settlement-rules";

type Option = Awaited<ReturnType<typeof getPaymentModeOptions>>[number];
type Ledger = Awaited<ReturnType<typeof getLedgerOptions>>[number];
export type ModeAccount = { modeId: string; accountId: string; /** The mode name, filled in when a choice is made. */ modeName?: string };

/**
 * Picks how money was received or paid: each payment mode is a heading with the accounts linked to it beneath, and the
 * choice is one of those accounts. The same account (a bank, say) can sit under several modes, so the choice keeps the
 * mode as well. A value that only has an account (an invoice being edited) shows under the first mode that includes it.
 * With `ledger`, the list ends with the ledger accounts a payment can be settled through instead (a director's account, the owner's
 * capital): no mode, and no cash or bank moves, so choosing one asks first. Only for screens whose payments may be settled that way.
 */
export function PaymentModeSelect({ value, onChange, className, ledger = false }: { value: ModeAccount; onChange: (v: ModeAccount) => void; className?: string; ledger?: boolean }) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  const ask = useConfirm();

  useEffect(() => {
    let live = true;
    getPaymentModeOptions()
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!ledger) return;
    let live = true;
    getLedgerOptions()
      .then((a) => live && setAccounts(a))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ledger]);

  const modeFor = (accountId: string) => options?.find((m) => m.accounts.some((a) => a.id === accountId))?.id ?? "";
  const modeId = value.modeId || (value.accountId ? modeFor(value.accountId) : "");

  // A line that starts with an account only (the default, or an invoice being edited) takes the mode it shows under, so the
  // mode is recorded whether or not the person touches the picker.
  useEffect(() => {
    if (options && value.accountId && !value.modeId && modeId) onChange({ modeId, accountId: value.accountId, modeName: options.find((o) => o.id === modeId)?.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value.accountId, value.modeId]);
  const viaLedger = !modeId && accounts.some((a) => a.id === value.accountId);
  const selected = viaLedger ? `|${value.accountId}` : value.accountId && modeId ? `${modeId}|${value.accountId}` : "";
  const groups = [...new Set(accounts.map((a) => a.group ?? ""))];

  return (
    <select
      value={selected}
      onChange={async (e) => {
        const [m, a] = e.target.value.split("|");
        const chosen = !m && a ? accounts.find((x) => x.id === a) : undefined;
        if (chosen && !(await ask(`Settle through ${ledgerLabel(chosen)}? No cash or bank moves: the amount is recorded against this account in your Chart of Accounts.`, { confirmLabel: "Settle through it" }))) return;
        onChange({ modeId: m ?? "", accountId: a ?? "", modeName: options?.find((o) => o.id === m)?.name });
      }}
      className={className}
    >
      <option value="">{options === null ? "Loading..." : options.length === 0 ? "No payment modes set up" : "Select mode"}</option>
      {(options ?? []).map((m) => (
        <optgroup key={m.id} label={m.name}>
          {m.accounts.map((a) => (
            <option key={a.id} value={`${m.id}|${a.id}`}>
              {a.code} — {a.name}
            </option>
          ))}
        </optgroup>
      ))}
      {groups.map((g) => (
        <optgroup key={g} label={g ? `Ledger account: ${g}` : "Ledger account"}>
          {accounts
            .filter((a) => (a.group ?? "") === g)
            .map((a) => (
              <option key={a.id} value={`|${a.id}`}>
                {a.code} — {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
