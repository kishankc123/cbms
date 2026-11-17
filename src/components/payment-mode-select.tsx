"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getLedgerOptions, getPaymentModeOptions } from "@/app/(app)/payment-mode-actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AmountInput } from "@/components/ui/amount-input";
import { ledgerLabel } from "@/lib/ledger/settlement-rules";

type Option = Awaited<ReturnType<typeof getPaymentModeOptions>>[number];
type Ledger = Awaited<ReturnType<typeof getLedgerOptions>>[number];
export type ModeAccount = { modeId: string; accountId: string; /** The mode name, filled in when a choice is made. */ modeName?: string };

export type LedgerOption = Ledger;

/** The ledger accounts a payment can be settled through (loaded once; empty until they arrive). */
export function useLedgerOptions(): LedgerOption[] {
  const [accounts, setAccounts] = useState<Ledger[]>([]);
  useEffect(() => {
    let live = true;
    getLedgerOptions()
      .then((a) => live && setAccounts(a))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return accounts;
}

/**
 * A separate picker for settling through a ledger account (a director's account, the owner's capital, a receivable netted off) instead of cash or
 * bank. Choosing one asks first, because no cash or bank moves: the amount is recorded against that account in the Chart of Accounts.
 */
export function LedgerSelect({ value, onChange, accounts, className }: { value: string; onChange: (accountId: string) => void; accounts: LedgerOption[]; className?: string }) {
  const ask = useConfirm();
  const groups = [...new Set(accounts.map((a) => a.group ?? ""))];
  return (
    <select
      value={value}
      onChange={async (e) => {
        const chosen = accounts.find((x) => x.id === e.target.value);
        if (chosen && !(await ask(`Settle through ${ledgerLabel(chosen)}? No cash or bank moves: the amount is recorded against this account in your Chart of Accounts.`, { confirmLabel: "Settle through it" }))) return;
        onChange(e.target.value);
      }}
      className={className}
    >
      <option value="">Select ledger account</option>
      {groups.map((g) => (
        <optgroup key={g} label={g || "Ledger account"}>
          {accounts
            .filter((a) => (a.group ?? "") === g)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export type LedgerLine = { accountId: string; amount: string };

/**
 * Payments settled through a ledger account have their own field, apart from the cash, bank and wallet rows. This holds those rows and, when a document
 * that was settled that way is being edited, moves its ledger lines out of the cash rows into the ledger field once the ledger accounts have loaded.
 */
export function useLedgerSplit<T extends { accountId: string; amount: string }>(cashLines: T[], setCashLines: Dispatch<SetStateAction<T[]>>, emptyLine: () => T) {
  const options = useLedgerOptions();
  const [ledgerLines, setLedgerLines] = useState<LedgerLine[]>([]);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (moved || options.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoved(true);
    const isLedger = (id: string) => options.some((a) => a.id === id);
    if (!cashLines.some((l) => isLedger(l.accountId))) return;
    setLedgerLines(cashLines.filter((l) => isLedger(l.accountId)).map((l) => ({ accountId: l.accountId, amount: l.amount })));
    const rest = cashLines.filter((l) => !isLedger(l.accountId));
    setCashLines(rest.length > 0 ? rest : [emptyLine()]);
  }, [options, moved, cashLines, setCashLines, emptyLine]);
  return { options, ledgerLines, setLedgerLines };
}

const ledgerControl = "rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3";

/** The "Settled through a ledger account" section of a payment screen. Shown only when the organization has ledger accounts to settle through. */
export function LedgerLinesField({ options, lines, onChange }: { options: LedgerOption[]; lines: LedgerLine[]; onChange: Dispatch<SetStateAction<LedgerLine[]>> }) {
  if (options.length === 0) return null;
  return (
    <div>
      <label className="mb-1 block text-xs text-ink-2">Settled through a ledger account (no cash or bank)</label>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <LedgerSelect accounts={options} value={l.accountId} onChange={(accountId) => onChange((prev) => prev.map((x, idx) => (idx === i ? { ...x, accountId } : x)))} className={`${ledgerControl} min-w-0 flex-1`} />
            <AmountInput bare type="number" step="0.01" min="0" value={l.amount} onChange={(e) => onChange((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))} placeholder="Amount" className={`${ledgerControl} w-28 shrink-0`} />
            <button type="button" aria-label="Remove" onClick={() => onChange((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 text-ink-3 hover:text-ink">
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange((prev) => [...prev, { accountId: "", amount: "" }])} className="mt-1 text-sm text-ink-2 hover:text-ink">
        + Add a ledger account
      </button>
    </div>
  );
}

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
