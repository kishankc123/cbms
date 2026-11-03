"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addAccount, getTdsHeads } from "./actions";
import { useProblem } from "@/components/problem-dialog";
import { TdsLinkField } from "./tds-link-field";
import { ACCOUNT_SUB_CATEGORIES } from "@/lib/ledger/account-sub-categories";
import type { TdsHead } from "@/lib/ledger/tds-links";

export type GroupChoice = { id: string; code: string; name: string; category: string; tdsHeadKey: string | null };

// One way to add to the chart: a new group, or an account inside an existing group. Expense accounts also get the TDS question,
// and an account inside a group starts out following the group's heading.
export function AddAccountDialog({ groups, label, startInside }: { groups: GroupChoice[]; label: string; startInside: boolean }) {
  const router = useRouter();
  const { report, dialog } = useProblem();
  const [open, setOpen] = useState(false);
  const [inside, setInside] = useState(startInside);
  const [parentId, setParentId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [subCategory, setSubCategory] = useState<string>(ACCOUNT_SUB_CATEGORIES[0].label);
  const [tds, setTds] = useState<string | null>(null);
  const [heads, setHeads] = useState<TdsHead[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) getTdsHeads().then(setHeads);
  }, [open]);

  const parent = inside ? groups.find((g) => g.id === parentId) : undefined;
  const isExpense = inside ? parent?.category === "expense" : ACCOUNT_SUB_CATEGORIES.find((sc) => sc.label === subCategory)?.category === "expense";
  const inherited = parent?.tdsHeadKey && parent.tdsHeadKey !== "none" ? heads.find((h) => h.key === parent.tdsHeadKey) ?? null : null;

  function close() {
    setOpen(false);
    setCode("");
    setName("");
    setTds(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await addAccount({ parentAccountId: inside ? parentId : null, code, name, subCategory, tdsHeadKey: isExpense ? tds : null });
      if (!r.ok) return report(r.error, /name/i.test(r.error) ? '[data-field="newName"]' : /group/i.test(r.error) ? '[data-field="newParent"]' : /categor|type/i.test(r.error) ? '[data-field="newCategory"]' : /TDS|heading/i.test(r.error) ? '[data-field="tdsHead"]' : '[data-field="newCode"]');
      close();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={close} />
          <form onSubmit={save} className="relative w-full max-w-md space-y-4 rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Add account</h2>
              <button type="button" onClick={close} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="flex gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!inside} onChange={() => setInside(false)} /> A new group
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={inside} onChange={() => setInside(true)} /> Inside a group
              </label>
            </div>

            {inside ? (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Group</label>
                <select data-field="newParent" value={parentId} onChange={(e) => { setParentId(e.target.value); setTds(null); }} required className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full">
                  <option value="">Select group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Code</label>
                  <input data-field="newCode" value={code} onChange={(e) => setCode(e.target.value)} required className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Category</label>
                  <select data-field="newCategory" value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full">
                    {ACCOUNT_SUB_CATEGORIES.map((sc) => (
                      <option key={sc.label} value={sc.label}>
                        {sc.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input data-field="newName" autoFocus value={name} onChange={(e) => setName(e.target.value)} required className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-full" />
            </div>

            {isExpense && <TdsLinkField heads={heads} value={tds} onChange={setTds} inherited={inherited} />}

            {dialog}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={busy || !name.trim() || (inside && !parentId)} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50">
                {busy ? "Adding..." : "Add"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
