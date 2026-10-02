"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/calendar/date-picker";
import { useProblem, type FieldRules } from "@/components/problem-dialog";
import { D } from "@/components/calendar/date-text";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect } from "@/components/quick-add/pickers";
import { todayIso } from "@/lib/calendar";
import { previewNextOccurrence, type RecurringFrequency, type RecognitionRule, type DueRule, type RecurringPriority } from "@/lib/recurring-expenses/schedule";
import { createRecurringExpense, updateRecurringExpense } from "./actions";

type Vendor = { id: string; name: string };
type CategoryAccount = { id: string; code: string; name: string };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };

export type InitialRecurringExpense = {
  id: string;
  expenseName: string;
  expenseAccountId: string;
  vendorId: string | null;
  payeeName: string | null;
  amount: string;
  frequency: RecurringFrequency;
  intervalMonths: number;
  recognitionRule: RecognitionRule;
  recognitionDay: number | null;
  dueRule: DueRule;
  dueRuleValue: number | null;
  startDate: string;
  endDate: string | null;
  priority: RecurringPriority;
  expectedPaymentAccountId: string | null;
  notes: string | null;
};

const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half-Yearly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

const RECOGNITION_RULES: { value: RecognitionRule; label: string }[] = [
  { value: "last_day", label: "Last day of month" },
  { value: "first_day", label: "First day of month" },
  { value: "specific_day", label: "Specific day of month" },
];

const DUE_RULES: { value: DueRule; label: string }[] = [
  { value: "same_day", label: "Same day as recognition" },
  { value: "specific_day_same_month", label: "Specific day, same month" },
  { value: "specific_day_following_month", label: "Specific day, following month" },
  { value: "days_after_recognition", label: "Days after recognition" },
];

const PRIORITIES: { value: RecurringPriority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const inputClass = "w-full rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1.5 text-sm text-[var(--text-primary)]";
const labelClass = "block text-xs text-[var(--text-secondary)] mb-1";

// Which field a message from the server is about, so the cursor can be put there after the message is read.
const SERVER_RULES: FieldRules = [
  [/expense name/i, '[data-field="name"]'],
  [/expense account|category/i, '[data-field="account"]'],
  [/amount/i, '[data-field="amount"]'],
  [/custom-frequency|months/i, '[data-field="interval"]'],
  [/recognition day/i, '[data-field="recognitionDay"]'],
  [/due|days after/i, '[data-field="dueValue"]'],
  [/end date/i, "#re-end"],
  [/start date/i, "#re-start"],
];

export function RecurringExpenseFormModal({
  vendors: vendorsProp,
  categoryAccounts,
  cashBankAccounts,
  initial,
  onClose,
}: {
  vendors: Vendor[];
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
  initial?: InitialRecurringExpense;
  onClose: () => void;
}) {
  const router = useRouter();
  const calendar = useCalendar();
  const [vendors, addVendor] = useWithAdded(vendorsProp);

  const [expenseName, setExpenseName] = useState(initial?.expenseName ?? "");
  const [expenseAccountId, setExpenseAccountId] = useState(initial?.expenseAccountId ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [payeeName, setPayeeName] = useState(initial?.payeeName ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");

  const [frequency, setFrequency] = useState<RecurringFrequency>(initial?.frequency ?? "monthly");
  const [customIntervalMonths, setCustomIntervalMonths] = useState(initial?.frequency === "custom" ? String(initial.intervalMonths) : "1");

  const [recognitionRule, setRecognitionRule] = useState<RecognitionRule>(initial?.recognitionRule ?? "last_day");
  const [recognitionDay, setRecognitionDay] = useState(initial?.recognitionDay ? String(initial.recognitionDay) : "1");

  const [dueRule, setDueRule] = useState<DueRule>(initial?.dueRule ?? "specific_day_following_month");
  const [dueRuleValue, setDueRuleValue] = useState(initial?.dueRuleValue !== undefined && initial?.dueRuleValue !== null ? String(initial.dueRuleValue) : "5");

  const [startDate, setStartDate] = useState(initial?.startDate ?? todayIso());
  const [noEndDate, setNoEndDate] = useState(!initial || !initial.endDate);
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");

  const [priority, setPriority] = useState<RecurringPriority>(initial?.priority ?? "normal");
  const [expectedPaymentAccountId, setExpectedPaymentAccountId] = useState(initial?.expectedPaymentAccountId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [saving, setSaving] = useState(false);
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { reportError, dialog } = useProblem();

  const preview = useMemo(() => {
    if (!startDate) return null;
    try {
      return previewNextOccurrence({
        calendar,
        startDate,
        recognitionRule,
        recognitionDay: recognitionRule === "specific_day" ? Number(recognitionDay) || 1 : null,
        dueRule,
        dueRuleValue: dueRule === "same_day" ? null : Number(dueRuleValue) || 0,
      });
    } catch {
      return null;
    }
  }, [calendar, startDate, recognitionRule, recognitionDay, dueRule, dueRuleValue]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const input = {
        expenseName,
        expenseAccountId,
        vendorId: vendorId || null,
        payeeName: payeeName.trim() || null,
        amount: Number(amount),
        frequency,
        customIntervalMonths: frequency === "custom" ? Number(customIntervalMonths) || null : null,
        recognitionRule,
        recognitionDay: recognitionRule === "specific_day" ? Number(recognitionDay) || null : null,
        dueRule,
        dueRuleValue: dueRule === "same_day" ? null : Number(dueRuleValue) || null,
        startDate,
        endDate: noEndDate ? null : endDate || null,
        priority,
        expectedPaymentAccountId: expectedPaymentAccountId || null,
        notes: notes.trim() || null,
      };
      if (initial) await updateRecurringExpense(initial.id, input);
      else await createRecurringExpense(input);
      router.refresh();
      onClose();
    } catch (err) {
      reportError(err, SERVER_RULES, '[data-field="name"]');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <form onSubmit={handleSubmit} className="relative w-full max-w-2xl rounded-lg bg-[var(--card-bg)] p-5 shadow-lg space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{initial ? "Edit Recurring Expense" : "New Recurring Expense"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            ✕
          </button>
        </div>

        {dialog}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Basic Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Expense Name</label>
              <input data-field="name" required value={expenseName} onChange={(e) => setExpenseName(e.target.value)} placeholder="e.g. Office Rent" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Expense Account</label>
              <select data-field="account" required value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)} className={inputClass}>
                <option value="">Select account</option>
                {categoryAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount</label>
              <input data-field="amount" required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Payable To (supplier)</label>
              <SupplierSelect value={vendorId} options={vendors} onChange={setVendorId} onAdded={addVendor} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Payable To (no supplier record)</label>
              <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="e.g. ABC Properties" className={inputClass} disabled={Boolean(vendorId)} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Recurrence</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)} className={inputClass}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            {frequency === "custom" && (
              <div>
                <label className={labelClass}>Repeats every (months)</label>
                <input data-field="interval" type="number" min="1" value={customIntervalMonths} onChange={(e) => setCustomIntervalMonths(e.target.value)} className={inputClass} />
              </div>
            )}

            <div>
              <label className={labelClass}>Expense Recognition Date</label>
              <select value={recognitionRule} onChange={(e) => setRecognitionRule(e.target.value as RecognitionRule)} className={inputClass}>
                {RECOGNITION_RULES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {recognitionRule === "specific_day" && (
              <div>
                <label className={labelClass}>Day of month</label>
                <input data-field="recognitionDay" type="number" min="1" max="31" value={recognitionDay} onChange={(e) => setRecognitionDay(e.target.value)} className={inputClass} />
              </div>
            )}

            <div>
              <label className={labelClass}>Payment Due</label>
              <select value={dueRule} onChange={(e) => setDueRule(e.target.value as DueRule)} className={inputClass}>
                {DUE_RULES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {dueRule !== "same_day" && (
              <div>
                <label className={labelClass}>{dueRule === "days_after_recognition" ? "Days after recognition" : "Day of month"}</label>
                <input data-field="dueValue" type="number" min="0" max={dueRule === "days_after_recognition" ? undefined : 31} value={dueRuleValue} onChange={(e) => setDueRuleValue(e.target.value)} className={inputClass} />
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Start &amp; End</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start Date</label>
              <DatePicker id="re-start" value={startDate} onChange={setStartDate} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>End Date</label>
              <DatePicker id="re-end" value={endDate} onChange={setEndDate} min={startDate} disabled={noEndDate} className={inputClass} />
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <input type="checkbox" checked={noEndDate} onChange={(e) => setNoEndDate(e.target.checked)} />
                Continue until manually stopped
              </label>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Planning</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Payment Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as RecurringPriority)} className={inputClass}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Expected Payment Account (optional)</label>
              <select value={expectedPaymentAccountId} onChange={(e) => setExpectedPaymentAccountId(e.target.value)} className={inputClass}>
                <option value="">None</option>
                {cashBankAccounts.map((g) =>
                  g.children.length > 0 ? (
                    <optgroup key={g.id} label={`${g.code} — ${g.name}`}>
                      {g.children.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </option>
                  )
                )}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
            </div>
          </div>
        </section>

        {preview && (
          <section className="rounded-md bg-[var(--surface-muted-bg)] p-3 text-xs text-[var(--text-secondary)]">
            <p className="mb-1.5 text-sm font-semibold text-[var(--text-primary)]">Recurrence Preview</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span>Next Expense Recognition</span>
              <span className="text-right font-medium text-[var(--text-primary)]">
                <D value={preview.expenseDate} style="short" />
              </span>
              <span>Expected Payment Due</span>
              <span className="text-right font-medium text-[var(--text-primary)]">
                <D value={preview.dueDate} style="short" />
              </span>
              <span>Period</span>
              <span className="text-right font-medium text-[var(--text-primary)]">{preview.periodLabel}</span>
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--card-border)] px-4 py-1.5 text-sm text-[var(--text-secondary)]">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
