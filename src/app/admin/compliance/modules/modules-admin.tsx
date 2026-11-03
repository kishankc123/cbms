"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useProblem } from "@/components/problem-dialog";
import { bearerLabel, effectOfRow, methodLabel, moduleLabel, postsToLabel, priceBasisLabel, TAX_BEARERS, TAX_METHODS, TAX_POSTS_TO, TAX_PRICE_BASES, type ModuleTaxChoice } from "@/lib/compliance/module-taxes";
import type { ModuleTaxData } from "@/lib/compliance/module-tax-admin";
import { adminCard, adminField } from "../../ui";
import { removeApplicableTax, saveApplicableTax } from "./actions";

type Editing = { taxKey: string } & ModuleTaxChoice;
const starting: ModuleTaxChoice = { method: "flat", bearer: "collected", priceBasis: "inclusive", postsTo: "tax_payable" };

/** One module's taxes: which apply and how. The rates are not here; they stay in Tax & rates. */
export function ModulesAdmin({ countryCode, countryName, moduleKey, data }: { countryCode: string; countryName: string; moduleKey: string; data: ModuleTaxData }) {
  const router = useRouter();
  const ask = useConfirm();
  const { reportError, dialog } = useProblem();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);

  const rowOf = (taxKey: string) => data.rows.find((r) => r.moduleKey === moduleKey && r.taxTypeKey === taxKey && r.isActive);
  const modulesOf = (taxKey: string) => [...new Set(data.rows.filter((r) => r.taxTypeKey === taxKey && r.isActive).map((r) => r.moduleKey))];
  const reach = `${data.organizations} organization${data.organizations === 1 ? "" : "s"} in ${countryName}`;

  async function save() {
    if (!editing) return;
    const taxName = data.taxes.find((t) => t.key === editing.taxKey)?.name ?? editing.taxKey;
    if (!(await ask(`This changes how ${taxName} applies in ${moduleLabel(moduleKey)} for ${reach}. Save the change?`, { confirmLabel: "Save change" }))) return;
    setBusy(true);
    try {
      const r = await saveApplicableTax({ countryCode, moduleKey, taxTypeKey: editing.taxKey, method: editing.method, bearer: editing.bearer, priceBasis: editing.priceBasis, postsTo: editing.postsTo });
      if (!r.ok) return reportError(new Error(r.error));
      setEditing(null);
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(taxKey: string, taxName: string) {
    if (!(await ask(`${taxName} will no longer apply in ${moduleLabel(moduleKey)} for ${reach}. Remove it from this module?`, { confirmLabel: "Remove" }))) return;
    setBusy(true);
    try {
      const r = await removeApplicableTax({ countryCode, moduleKey, taxTypeKey: taxKey });
      if (!r.ok) return reportError(new Error(r.error));
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  const select = (value: string, options: readonly { key: string; label: string }[], onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${adminField} mt-1 w-full`}>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      {dialog}
      <section className={`${adminCard} overflow-x-auto p-5`}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{moduleLabel(moduleKey)}: applicable taxes</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Tax</th>
              <th className="py-1 pr-3 font-medium">Worked out by</th>
              <th className="py-1 pr-3 font-medium">Who bears it</th>
              <th className="py-1 pr-3 font-medium">Price</th>
              <th className="py-1 pr-3 font-medium">Posts to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.taxes.map((t) => {
              const row = rowOf(t.key);
              return (
                <tr key={t.key} className="border-t border-[var(--card-border)] align-top">
                  <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">{t.name}</td>
                  {row ? (
                    <>
                      <td className="py-2 pr-3">{methodLabel(row.method)}</td>
                      <td className="py-2 pr-3">{bearerLabel(row.bearer)}</td>
                      <td className="py-2 pr-3">{priceBasisLabel(row.priceBasis)}</td>
                      <td className="py-2 pr-3">{postsToLabel(row.postsTo)}</td>
                      <td className="whitespace-nowrap py-2 text-right">
                        <button type="button" disabled={busy} onClick={() => setEditing({ taxKey: t.key, method: row.method, bearer: row.bearer, priceBasis: row.priceBasis, postsTo: row.postsTo })} className="mr-3 text-[var(--accent-text)] hover:underline">
                          Edit
                        </button>
                        <button type="button" disabled={busy} onClick={() => remove(t.key, t.name)} className="text-red-600 hover:underline">
                          Remove
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-3" colSpan={4}>
                        <StatusPill tone="pending">Not applied</StatusPill>
                      </td>
                      <td className="py-2 text-right">
                        <button type="button" disabled={busy} onClick={() => setEditing({ taxKey: t.key, ...starting })} className="text-[var(--accent-text)] hover:underline">
                          Apply
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {data.taxes.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-[var(--text-secondary)]">
                  This country has no taxes set up yet. Add them under Setup → Countries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--text-secondary)]">Rates and slabs are not set here. They stay in Tax &amp; rates, by fiscal year. This only says which tax applies in this module and how.</p>
      </section>

      {editing && (
        <section className={`${adminCard} space-y-3 p-5`}>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {moduleLabel(moduleKey)} · {data.taxes.find((t) => t.key === editing.taxKey)?.name}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--text-secondary)]">
              Worked out by
              {select(editing.method, TAX_METHODS, (v) => setEditing({ ...editing, method: v }))}
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Who bears it
              {select(editing.bearer, TAX_BEARERS, (v) => setEditing({ ...editing, bearer: v }))}
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Price
              {select(editing.priceBasis, TAX_PRICE_BASES, (v) => setEditing({ ...editing, priceBasis: v }))}
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Posts to
              {select(editing.postsTo, TAX_POSTS_TO, (v) => setEditing({ ...editing, postsTo: v }))}
            </label>
          </div>
          <div className="rounded bg-[var(--surface-muted-bg)] p-3 text-sm text-[var(--text-secondary)]">
            <p className="mb-1 text-xs font-medium text-[var(--text-primary)]">What this means</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {effectOfRow(moduleKey, data.taxes.find((t) => t.key === editing.taxKey)?.name ?? editing.taxKey, editing).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">Modules keep following their own rules for now; the platform records this and modules will read it as they are moved over one at a time. It reaches {reach}.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={save} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)} className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700">
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className={`${adminCard} overflow-x-auto p-5`}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Where each tax is used</h2>
        <table className="w-full text-sm">
          <tbody>
            {data.taxes.map((t) => (
              <tr key={t.key} className="border-t border-[var(--card-border)]">
                <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">{t.name}</td>
                <td className="py-1.5 text-[var(--text-secondary)]">{modulesOf(t.key).length ? modulesOf(t.key).map(moduleLabel).join(", ") : "No module yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
