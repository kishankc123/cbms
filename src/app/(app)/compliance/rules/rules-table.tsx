"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRule, setRuleActive, deleteRule, type listRules, type RuleInput } from "../actions";

type Rule = Awaited<ReturnType<typeof listRules>>[number];

const MODULES: { value: RuleInput["applicableModule"]; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "purchases", label: "Purchases" },
  { value: "expenses", label: "Expenses" },
  { value: "payroll", label: "Payroll" },
  { value: "bank_reconciliation", label: "Bank Reconciliation" },
  { value: "general", label: "General" },
];

const CHECK_TYPES: { value: RuleInput["checkType"]; label: string; needsThreshold: boolean; hint: string }[] = [
  { value: "amount_threshold", label: "Amount exceeds threshold", needsThreshold: true, hint: "Blocks/warns when a transaction total exceeds this amount. Live-enforced on Expenses today." },
  { value: "missing_pan", label: "Supplier PAN missing", needsThreshold: false, hint: "Flags suppliers with transactions but no PAN on file (via Exception Centre scan)." },
  { value: "duplicate_invoice", label: "Duplicate invoice", needsThreshold: false, hint: "Always detected automatically — this rule just lets you set its severity." },
  { value: "closed_period_posting", label: "Posting into a closed period", needsThreshold: false, hint: "Already blocked by Period Locking — this rule is informational." },
  { value: "bank_unreconciled_days", label: "Bank line unreconciled for N days", needsThreshold: true, hint: "Threshold = number of days. Detected via Exception Centre scan." },
  { value: "negative_balance", label: "Negative cash/bank balance", needsThreshold: false, hint: "Always detected automatically — this rule just lets you set its severity." },
  { value: "backdated_transaction", label: "Transaction backdated by N days", needsThreshold: true, hint: "Threshold = number of days between posting and entry date. Detected via Exception Centre scan." },
];

const SEVERITIES: RuleInput["severity"][] = ["information", "warning", "review_required", "blocking"];
const ACTIONS: RuleInput["action"][] = ["warn", "block", "create_exception"];

export function RulesTable({ rules }: { rules: Rule[] }) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [applicableModule, setApplicableModule] = useState<RuleInput["applicableModule"]>("general");
  const [checkType, setCheckType] = useState<RuleInput["checkType"]>("amount_threshold");
  const [thresholdValue, setThresholdValue] = useState("");
  const [severity, setSeverity] = useState<RuleInput["severity"]>("warning");
  const [action, setAction] = useState<RuleInput["action"]>("warn");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const selectedCheck = CHECK_TYPES.find((c) => c.value === checkType)!;

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      await createRule({
        name,
        category,
        description,
        applicableModule,
        checkType,
        thresholdValue: selectedCheck.needsThreshold && thresholdValue ? parseFloat(thresholdValue) : null,
        severity,
        action,
        approvalRequired,
        effectiveDate,
        expiryDate,
      });
      setShowNew(false);
      setName("");
      setCategory("");
      setDescription("");
      setThresholdValue("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rule");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(rule: Rule) {
    setBusy(true);
    try {
      await setRuleActive({ ruleId: rule.id, isActive: !rule.isActive });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rule?")) return;
    setBusy(true);
    try {
      await deleteRule(id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowNew(true)} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5">
          + New Rule
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Module</th>
            <th className="px-4 py-2 font-medium">Check</th>
            <th className="px-4 py-2 font-medium">Threshold</th>
            <th className="px-4 py-2 font-medium">Severity</th>
            <th className="px-4 py-2 font-medium">Action</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-4 py-2">{r.name}</td>
              <td className="px-4 py-2 capitalize">{r.applicableModule.replace("_", " ")}</td>
              <td className="px-4 py-2">{CHECK_TYPES.find((c) => c.value === r.checkType)?.label ?? r.checkType}</td>
              <td className="px-4 py-2">{r.thresholdValue ?? "—"}</td>
              <td className="px-4 py-2 capitalize">{r.severity.replace("_", " ")}</td>
              <td className="px-4 py-2 capitalize">{r.action.replace("_", " ")}</td>
              <td className="px-4 py-2">{r.isActive ? "Active" : "Inactive"}</td>
              <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                <button type="button" disabled={busy} onClick={() => toggleActive(r)} className="text-xs text-gray-600 hover:underline disabled:opacity-40">
                  {r.isActive ? "Deactivate" : "Activate"}
                </button>
                <button type="button" disabled={busy} onClick={() => handleDelete(r.id)} className="text-xs text-red-600 hover:underline disabled:opacity-40">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                No rules configured yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowNew(false)} />
          <div className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-lg space-y-4">
            <h2 className="text-base font-semibold text-gray-900">New rule</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Rule name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Documentation" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Applicable module</label>
                <select value={applicableModule} onChange={(e) => setApplicableModule(e.target.value as RuleInput["applicableModule"])} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {MODULES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Condition</label>
                <select value={checkType} onChange={(e) => setCheckType(e.target.value as RuleInput["checkType"])} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {CHECK_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">{selectedCheck.hint}</p>
              </div>
              {selectedCheck.needsThreshold && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Threshold</label>
                  <input type="number" step="0.01" value={thresholdValue} onChange={(e) => setThresholdValue(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Severity</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as RuleInput["severity"])} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Action</label>
                <select value={action} onChange={(e) => setAction(e.target.value as RuleInput["action"])} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} id="approvalRequired" />
                <label htmlFor="approvalRequired" className="text-xs text-gray-600">
                  Requires approval (recorded only — not enforced yet)
                </label>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Effective date</label>
                <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Expiry date</label>
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" disabled={busy || !name.trim()} onClick={handleCreate} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
