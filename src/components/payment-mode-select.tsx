"use client";

import { useEffect, useState } from "react";
import { getPaymentModeOptions } from "@/app/(app)/payment-mode-actions";

type Option = Awaited<ReturnType<typeof getPaymentModeOptions>>[number];
export type ModeAccount = { modeId: string; accountId: string; /** The mode name, filled in when a choice is made. */ modeName?: string };

/**
 * Picks how money was received or paid: each payment mode is a heading with the accounts linked to it beneath, and the
 * choice is one of those accounts. The same account (a bank, say) can sit under several modes, so the choice keeps the
 * mode as well. A value that only has an account (an invoice being edited) shows under the first mode that includes it.
 */
export function PaymentModeSelect({ value, onChange, className }: { value: ModeAccount; onChange: (v: ModeAccount) => void; className?: string }) {
  const [options, setOptions] = useState<Option[] | null>(null);

  useEffect(() => {
    let live = true;
    getPaymentModeOptions()
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, []);

  const modeFor = (accountId: string) => options?.find((m) => m.accounts.some((a) => a.id === accountId))?.id ?? "";
  const modeId = value.modeId || (value.accountId ? modeFor(value.accountId) : "");

  // A line that starts with an account only (the default, or an invoice being edited) takes the mode it shows under, so the
  // mode is recorded whether or not the person touches the picker.
  useEffect(() => {
    if (options && value.accountId && !value.modeId && modeId) onChange({ modeId, accountId: value.accountId, modeName: options.find((o) => o.id === modeId)?.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value.accountId, value.modeId]);
  const selected = value.accountId && modeId ? `${modeId}|${value.accountId}` : "";

  return (
    <select
      value={selected}
      onChange={(e) => {
        const [m, a] = e.target.value.split("|");
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
    </select>
  );
}
