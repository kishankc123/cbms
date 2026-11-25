"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BankLogo } from "@/components/bank-logo";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useProblem } from "@/components/problem-dialog";
import { defaultModeNames, KIND_LABEL, type Institution, type InstitutionKind } from "@/lib/banking/institution-rules";
import { createBankAccount, updateBankAccount, type BankAccountInput } from "../actions";
import { ChangeMethod } from "../change-method";
import type { ReconcileMethod } from "@/lib/ledger/cash-reconcile-rules";

type LedgerOption = { id: string; code: string; name: string };
export type FormOptions = { institutions: Institution[]; modes: { id: string; name: string }[]; canSetModes: boolean };
export type InitialBankAccount = BankAccountInput & { bankAccountId: string; ledgerLabel: string; modeIds: string[]; /** A bank account (not cash or a wallet): it can be reconciled by statement or by ticking. */ isBank: boolean; method: ReconcileMethod };

// Adding an account is two steps: choose the bank or wallet from the list (or "Other"), then the details that are personal to the account.
// Editing starts at the second step, with the bank or wallet it already has.
export function BankAccountFormModal({ ledgerOptions, options, initial, onClose }: { ledgerOptions: LedgerOption[]; options: FormOptions; initial?: InitialBankAccount; onClose: () => void }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const picked = options.institutions.find((i) => i.id === initial?.institutionId) ?? null;
  const [step, setStep] = useState<1 | 2>(initial ? 2 : 1);
  const [institution, setInstitution] = useState<Institution | null>(picked);
  const [search, setSearch] = useState("");
  const [f, setF] = useState({
    bankName: initial?.bankName ?? "",
    accountName: initial?.accountName ?? "",
    accountNumber: initial?.accountNumber ?? "",
    branch: initial?.branch ?? "",
    currency: initial?.currency ?? "NPR",
    openingBalance: initial ? String(initial.openingBalance) : "0",
    chartOfAccountsLink: initial?.chartOfAccountsLink ?? "",
  });
  const [modeIds, setModeIds] = useState<string[]>(initial?.modeIds ?? []);
  const [method, setMethod] = useState<ReconcileMethod>(initial?.method ?? "statement");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));
  const shownName = institution?.name ?? f.bankName;

  function choose(i: Institution | null) {
    setInstitution(i);
    setStep(2);
    if (initial) return;
    // A new account starts with the bank's name, and with the payment modes such an account is usually used for.
    set({ accountName: i?.name ?? "", bankName: i?.name ?? "" });
    const names = i ? defaultModeNames(i.kind, i.name).map((n) => n.toLowerCase()) : [];
    setModeIds(options.modes.filter((m) => names.includes(m.name.toLowerCase())).map((m) => m.id));
  }

  async function save() {
    if (!f.accountName.trim()) return report("Enter the account name.", '[data-field="name"]');
    setSaving(true);
    try {
      const payload: BankAccountInput = { ...f, institutionId: institution?.id ?? null, openingBalance: parseFloat(f.openingBalance) || 0, modeIds: options.canSetModes ? modeIds : undefined };
      if (initial) await updateBankAccount({ ...payload, bankAccountId: initial.bankAccountId });
      else await createBankAccount(payload);
      router.refresh();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  if (step === 1) {
    const q = search.trim().toLowerCase();
    const shown = options.institutions.filter((i) => i.name.toLowerCase().includes(q) || (i.code ?? "").toLowerCase().includes(q));
    return (
      <Modal title="Choose your bank or wallet" description="Pick where the money is held." size="md" onClose={onClose}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code, for example nabil or esewa" className="mb-3" autoFocus />
        {(Object.keys(KIND_LABEL) as InstitutionKind[]).map((k) => {
          const group = shown.filter((i) => i.kind === k);
          return group.length === 0 ? null : (
            <div key={k} className="mb-3">
              <p className="mb-1 text-xs font-medium text-ink-2">{KIND_LABEL[k]}</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {group.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => choose(i)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] text-ink hover:bg-hover">
                      <BankLogo name={i.name} institution={i} />
                      <span className="flex-1">{i.name}</span>
                      {i.code && <span className="text-xs text-ink-2">{i.code}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {shown.length === 0 && <p className="mb-3 text-[13px] text-ink-2">Nothing in the list matches. Choose Other below.</p>}
        <button type="button" onClick={() => choose(null)} className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line-strong px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-hover">
          <BankLogo name="+" /> Other bank or wallet (not in the list)
        </button>
        {dialog}
      </Modal>
    );
  }

  return (
    <Modal
      title={initial ? "Edit bank account" : "Add bank account"}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
          <BankLogo name={shownName || "?"} institution={institution} size={34} />
          <div className="min-w-0 flex-1">
            {institution ? <p className="truncate text-[13px] font-medium text-ink">{institution.name}</p> : <Input value={f.bankName} onChange={(e) => set({ bankName: e.target.value })} placeholder="Bank or wallet name" aria-label="Bank or wallet name" />}
          </div>
          <Button size="sm" onClick={() => setStep(1)}>
            Change
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account name" required className="col-span-2">
            <Input data-field="name" value={f.accountName} onChange={(e) => set({ accountName: e.target.value })} />
          </Field>
          <Field label="Account number">
            <Input value={f.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} />
          </Field>
          <Field label="Branch">
            <Input value={f.branch} onChange={(e) => set({ branch: e.target.value })} />
          </Field>
          <Field label="Currency">
            <Input value={f.currency} onChange={(e) => set({ currency: e.target.value })} />
          </Field>
          <Field label="Opening balance">
            <AmountInput value={f.openingBalance} onChange={(e) => set({ openingBalance: e.target.value })} className="text-right" />
          </Field>
          <Field
            label="Ledger account"
            className="col-span-2"
            hint={initial ? undefined : f.chartOfAccountsLink ? "This existing account is linked as it is." : "A new account is added to your Chart of Accounts under Bank (for example 1010.03) and linked here, so it appears in both places."}
          >
            {initial ? (
              <Input disabled value={initial.ledgerLabel} />
            ) : (
              <Select data-field="ledger" value={f.chartOfAccountsLink} onChange={(e) => set({ chartOfAccountsLink: e.target.value })}>
                <option value="">Create a new account under Bank (recommended)</option>
                {ledgerOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {initial?.isBank && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px]">
            <div>
              <p className="font-medium text-ink">How it is reconciled</p>
              <p className="text-xs text-ink-2">{method === "ticking" ? "By ticking entries and confirming the balance, for when there is no statement to upload." : "Against the bank statement you upload."}</p>
            </div>
            <ChangeMethod bankAccountId={initial.bankAccountId} label={initial.accountName} method={method} stay onChanged={setMethod} className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-hover" />
          </div>
        )}
        {options.canSetModes && options.modes.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-ink-2">Can be used for</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {options.modes.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-[13px] text-ink">
                  <input type="checkbox" checked={modeIds.includes(m.id)} onChange={(e) => setModeIds((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))} />
                  {m.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-2">The payment modes this account is offered under when you record a payment.</p>
          </fieldset>
        )}
      </div>
      {dialog}
    </Modal>
  );
}
