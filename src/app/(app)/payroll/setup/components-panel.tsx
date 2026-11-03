"use client";

import { useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { createComponent, deleteComponent } from "./actions";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Component = { id: string; name: string; type: string; amount: string; taxable: boolean };

export function ComponentsPanel({ components }: { components: Component[] }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"allowance" | "deduction">("allowance");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createComponent({ name: name.trim(), type, amount: parseFloat(amount) || 0, taxable });
      setName("");
      setAmount("");
      setShowAdd(false);
      router.refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setBusy(false);
    }
  }

  const ask = useConfirm();
  async function handleDelete(id: string, componentName: string) {
    if (!(await ask(`Delete ${componentName}?`, { confirmLabel: "Delete", danger: true }))) return;
    await deleteComponent({ componentId: id });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50 ml-auto"
        >
          + Add component
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-2.5 py-1.5 font-medium">Name</th>
            <th className="px-2.5 py-1.5 font-medium">Type</th>
            <th className="px-2.5 py-1.5 font-medium">Amount</th>
            <th className="px-2.5 py-1.5 font-medium">Taxable</th>
            <th className="px-2.5 py-1.5 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {components.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="px-2.5 py-1.5">{c.name}</td>
              <td className="px-2.5 py-1.5 capitalize">{c.type}</td>
              <td className="px-2.5 py-1.5">{Number(c.amount).toFixed(2)}</td>
              <td className="px-2.5 py-1.5">{c.taxable ? "Yes" : "No"}</td>
              <td className="px-2.5 py-1.5 text-right">
                <button type="button" onClick={() => handleDelete(c.id, c.name)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {components.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                No components yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={() => setShowAdd(false)} />
          <div className="relative w-full max-w-sm rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Add component</h2>
              <button type="button" onClick={() => setShowAdd(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full">
                <option value="allowance">Allowance</option>
                <option value="deduction">Deduction</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
              Taxable
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={handleCreate} disabled={busy} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
