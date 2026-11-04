"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createExpense, getTdsRateOn, suggestExpense, updateExpense, updateExpenseDetails, type ExpenseInput, type ExpenseTaxTreatment, type ExpenseBillType } from "./actions";
import type { ExpenseSuggestion } from "@/lib/expenses/suggestion-rules";
import { D } from "@/components/calendar/date-text";
import { useWithAdded } from "@/components/quick-add/use-with-added";
import { SupplierSelect } from "@/components/quick-add/pickers";
import { BillAvailableToggle } from "@/components/bill-available-toggle";
import { useProblem } from "@/components/problem-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InvoicePaymentModal } from "../purchases/invoice-payment-modal";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { controlClass, Field, Input, Select } from "@/components/ui/field";
import { Amount } from "@/components/ui/data-table";
type Vendor = { id: string; name: string };
// Only lowest-level accounts are offered; `group` is the account they sit under, if any.
type CategoryAccount = { id: string; code: string; name: string; group?: string | null; tdsHeadKey?: string | null };
type CashBankGroup = { id: string; code: string; name: string; children: { id: string; code: string; name: string }[] };
type PaymentLine = { accountId: string; amount: number; modeId?: string | null };

const TAX_TREATMENTS: { value: ExpenseTaxTreatment; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "exempt", label: "Exempt" },
  { value: "zero_rated", label: "Zero-rated" },
];

const BILL_TYPES: { value: ExpenseBillType; label: string }[] = [
  { value: "no_bill", label: "No bill" },
  { value: "vat", label: "VAT" },
  { value: "pan", label: "PAN" },
  { value: "estimate", label: "Estimate" },
  { value: "challan", label: "Challan" },
];

const today = () => todayIso();
const round2 = (n: number) => Math.round(n * 100) / 100;

export type InitialExpense = ExpenseInput & { expenseId: string; expenseNumber: string; detailsOnly?: boolean };

type FieldKey = "expenseDate" | "category" | "supplier" | "billType" | "invoiceNumber" | "invoiceDate" | "dueDate" | "taxable" | "taxTreatment" | "vat" | "tds" | "pay";

// Which field a message from the server is about, so the cursor can be put there after the message is read.
function fieldForMessage(message: string): string | null {
  const rules: [RegExp, FieldKey][] = [
    [/closed period|expense date/i, "expenseDate"],
    [/bill type is VAT/i, "billType"],
    [/exempt|zero-rated/i, "taxTreatment"],
    [/invoice/i, "invoiceNumber"],
    [/due date/i, "dueDate"],
    [/category/i, "category"],
    [/supplier/i, "supplier"],
    [/taxable amount/i, "taxable"],
    [/TDS/, "tds"],
    [/payment|Cash or Bank/i, "pay"],
  ];
  const key = rules.find(([re]) => re.test(message))?.[1];
  return key ? at(key) : null;
}

// The selector of a field on this form: a marked control, or a date picker by id.
const at = (key: FieldKey) => `[data-field="${key}"], #exp-${key}`;

// New Expense and Edit Expense share one form — sections mirror the spec:
// Expense Information, Invoice/Supporting Document, Tax Information, Amount
// (computed, read-only), Settlement.
export function ExpenseFormModal({
  vendors: vendorsProp,
  categoryAccounts,
  cashBankAccounts,
  vatRate,
  initial,
  onClose,
}: {
  vendors: Vendor[];
  categoryAccounts: CategoryAccount[];
  cashBankAccounts: CashBankGroup[];
  vatRate: number;
  initial?: InitialExpense;
  onClose: () => void;
}) {
  const router = useRouter();
  const [vendors, addVendor] = useWithAdded(vendorsProp);
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? today());
  const [categoryAccountId, setCategoryAccountId] = useState(initial?.categoryAccountId ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [billType, setBillType] = useState<ExpenseBillType>(initial?.billType ?? "no_bill");
  const [billAvailable, setBillAvailable] = useState(initial?.billAvailable ?? true);
  const [taxTreatment, setTaxTreatment] = useState<ExpenseTaxTreatment>(initial?.taxTreatment ?? "taxable");
  const [taxableAmount, setTaxableAmount] = useState(initial ? String(initial.taxableAmount) : "");
  const [vatAmount, setVatAmount] = useState(initial ? String(initial.vatAmount) : "0.00");
  const [tdsAmount, setTdsAmount] = useState(initial ? String(initial.tdsAmount) : "0.00");
  const [otherTaxAmount, setOtherTaxAmount] = useState(initial ? String(initial.otherTaxAmount) : "0");
  const [vatTouched, setVatTouched] = useState(Boolean(initial));
  const [tdsTouched, setTdsTouched] = useState(Boolean(initial));
  const [payments, setPayments] = useState<PaymentLine[]>(initial?.payments ?? []);
  const [showPayment, setShowPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  // What the typed description meant last time. Only for a new expense; it is shown, never filled in without a click.
  const [found, setFound] = useState<{ text: string; suggestion: ExpenseSuggestion | null } | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  // Payments recorded later in Payments pin the amounts: then only the details can be edited.
  const locked = Boolean(initial?.detailsOnly);
  // Every problem is shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const ask = useConfirm();
  const { problem, report, dialog } = useProblem();

  // The date is already today, so the cursor starts in the description.
  useEffect(() => {
    if (initial) return;
    const t = setTimeout(() => descriptionRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Looks up the description a quarter of a second after typing stops. A late answer for older text is thrown away.
  useEffect(() => {
    const text = description.trim();
    if (initial || text.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      suggestExpense(text)
        .then((suggestion) => live && setFound({ text, suggestion }))
        .catch(() => live && setFound(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [description, initial]);
  const suggestion = !initial && found && found.text === description.trim() ? found.suggestion : null;

  // The TDS heading follows the chosen category (set on it or its group in the Chart of Accounts); its rate is the platform's, on the expense date.
  const tdsHead = categoryAccounts.find((c) => c.id === categoryAccountId)?.tdsHeadKey ?? null;
  const [fetched, setFetched] = useState<{ rate: number; basis: string | null }>({ rate: 0, basis: null });
  useEffect(() => {
    let live = true;
    if (tdsHead) getTdsRateOn(tdsHead, expenseDate, vendorId || null).then((r) => live && setFetched(r));
    return () => {
      live = false;
    };
  }, [tdsHead, expenseDate, vendorId]);
  const tdsRate = tdsHead ? fetched.rate : 0;

  // Auto-fills VAT/TDS from the tenant's configured rates as the taxable
  // amount or treatment changes — never hard-coded, and the user can still
  // type their own figure, which then stops the auto-fill for that field.
  useEffect(() => {
    const amount = parseFloat(taxableAmount) || 0;
    if (billType !== "vat") {
      setVatAmount("0.00");
    } else if (!vatTouched) {
      const rate = taxTreatment === "taxable" ? vatRate : 0;
      setVatAmount(round2(amount * (rate / 100)).toFixed(2));
    }
    if (!tdsTouched) {
      setTdsAmount(round2(amount * (tdsRate / 100)).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxableAmount, taxTreatment, billType, tdsRate]);

  // Categories that have sub-categories are shown only as group headings — the sub-categories are what can be chosen.
  const categoryGroups: { label: string | null; items: CategoryAccount[] }[] = [];
  for (const a of categoryAccounts) {
    const label = a.group ?? null;
    const g = categoryGroups.find((x) => x.label === label);
    if (g) g.items.push(a);
    else categoryGroups.push({ label, items: [a] });
  }
  categoryGroups.sort((a, b) => (a.label === null ? -1 : b.label === null ? 1 : a.label.localeCompare(b.label)));

  const categoryName = (id: string) => {
    const c = categoryAccounts.find((x) => x.id === id);
    return c ? `${c.code} — ${c.name}` : null;
  };
  function applySuggestion(categoryId: string, amount: number | null) {
    setCategoryAccountId(categoryId);
    if (amount !== null) setTaxableAmount(String(amount));
    setApplied(suggestion?.last.number ?? "");
  }

  const accountLabels: Record<string, string> = {};
  for (const g of cashBankAccounts) {
    if (g.children.length === 0) accountLabels[g.id] = g.name;
    else for (const c of g.children) accountLabels[c.id] = c.name;
  }

  const subtotal = round2(parseFloat(taxableAmount) || 0);
  const vat = round2(parseFloat(vatAmount) || 0);
  const tds = round2(parseFloat(tdsAmount) || 0);
  const otherTax = round2(parseFloat(otherTaxAmount) || 0);
  const total = round2(subtotal + vat + otherTax);
  const amountPayable = round2(total - tds);
  const paidTotal = round2(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = Math.max(round2(amountPayable - paidTotal), 0);

  // Everything is checked first; then the person is asked once, and only a yes saves.
  async function askThenSave() {
    setAsking(true);
    const yes = await ask("Do you want to save?", { confirmLabel: "Save" });
    setAsking(false);
    if (yes) performSave();
  }

  function handleSaveClick() {
    if (locked) return askThenSave();
    if (!categoryAccountId) return report("Select an expense category.", at("category"));
    if (subtotal <= 0) return report("Taxable amount must be greater than zero.", at("taxable"));
    if (amountPayable < 0) return report("TDS and other withholdings cannot exceed the total expense amount.", at("tds"));
    if (!vendorId && remaining > 0) {
      return report("Select a supplier: the unpaid balance needs someone it is owed to. A supplier isn't needed once the expense is paid in full.", at("supplier"));
    }
    askThenSave();
  }

  async function performSave() {
    setSaving(true);
    try {
      const payload: ExpenseInput = {
        expenseDate,
        categoryAccountId,
        vendorId: vendorId || null,
        description,
        invoiceNumber,
        invoiceDate,
        dueDate,
        billType,
        billAvailable,
        taxTreatment,
        taxableAmount: subtotal,
        vatAmount: vat,
        tdsAmount: tds,
        otherTaxAmount: otherTax,
        payments,
      };

      if (initial && locked) {
        await updateExpenseDetails({ expenseId: initial.expenseId, description, invoiceNumber, invoiceDate, dueDate, billAvailable });
      } else if (initial) {
        await updateExpense({ ...payload, expenseId: initial.expenseId });
      } else {
        const result = await createExpense(payload);
        if (result.warnings.length > 0) {
          await ask(`Saved, but flagged by Rules & Policies:\n\n${result.warnings.join("\n")}`, { title: "Saved with a warning", confirmLabel: "OK", cancelLabel: "" });
        }
      }
      router.refresh();
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save";
      report(message, fieldForMessage(message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        size="xl"
        title={initial ? `Edit expense ${initial.expenseNumber}` : "New expense"}
        onClose={onClose}
        dismissible={!showPayment && !problem && !saving && !asking}
        footer={
          <>
            <Button data-field="pay" onClick={() => setShowPayment(true)} disabled={amountPayable <= 0 || locked}>
              {payments.length > 0 ? "Edit payment" : "Record payment"}
            </Button>
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveClick} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {locked && (
            <p className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]">
              Payments have been recorded against this expense in Payments, so its amounts, category, date and supplier are locked. You can still change the description, invoice details and bill availability. To change the amounts, void those payments first.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
            <section className="space-y-3">
              <SectionTitle>What and when</SectionTitle>
              <Field label="Expense date">
                <DatePicker id="exp-expenseDate" disabled={locked} max={today()} value={expenseDate} onChange={(v) => setExpenseDate(v)} className={`${controlClass} w-full`} />
              </Field>
              <Field label="Description">
                <Input ref={descriptionRef} value={description} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
              </Field>

              {suggestion && (
                <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink" aria-live="polite">
                  <p className="font-medium">
                    You have used &ldquo;{suggestion.description}&rdquo; {suggestion.times === 1 ? "once" : `${suggestion.times} times`} before
                  </p>
                  <dl className="mt-1.5 space-y-0.5 text-xs text-ink-2">
                    <div className="flex justify-between gap-3">
                      <dt>Last category</dt>
                      <dd className="text-right text-ink">{categoryName(suggestion.last.categoryAccountId) ?? "No longer available"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Last date</dt>
                      <dd className="text-right text-ink">
                        <D value={suggestion.last.date} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Last amount</dt>
                      <dd className="text-right text-ink">
                        <Amount value={suggestion.last.amount} />
                      </dd>
                    </div>
                    {suggestion.range && (
                      <div className="flex justify-between gap-3">
                        <dt>Usually</dt>
                        <dd className="text-right text-ink">
                          <Amount value={suggestion.range.min} /> to <Amount value={suggestion.range.max} />
                        </dd>
                      </div>
                    )}
                  </dl>
                  {applied !== null ? (
                    <p className="mt-2 text-xs text-ink-2">Filled in from {applied || "the last one"}. You can change anything.</p>
                  ) : (
                    categoryName(suggestion.last.categoryAccountId) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="sm" onClick={() => applySuggestion(suggestion.last.categoryAccountId, null)}>
                          Use category
                        </Button>
                        <Button size="sm" onClick={() => applySuggestion(suggestion.last.categoryAccountId, suggestion.last.amount)}>
                          Use category and amount
                        </Button>
                      </div>
                    )
                  )}
                  {applied === null && suggestion.others.some((o) => categoryName(o.categoryAccountId)) && (
                    <p className="mt-2 text-xs text-ink-2">
                      Also used for:{" "}
                      {suggestion.others
                        .filter((o) => categoryName(o.categoryAccountId))
                        .slice(0, 3)
                        .map((o, i) => (
                          <span key={o.categoryAccountId}>
                            {i > 0 && ", "}
                            <button type="button" className="text-accent-text hover:underline" onClick={() => applySuggestion(o.categoryAccountId, null)}>
                              {categoryName(o.categoryAccountId)}
                            </button>{" "}
                            ({o.count})
                          </span>
                        ))}
                    </p>
                  )}
                </div>
              )}

              <Field label="Expense number">
                <Input disabled value={initial?.expenseNumber ?? "Auto-generated on save"} readOnly />
              </Field>
            </section>

            <section className="space-y-3">
              <SectionTitle>Category and supplier</SectionTitle>
              <Field label="Expense category">
                <Select data-field="category" disabled={locked} value={categoryAccountId} onChange={(e) => setCategoryAccountId(e.target.value)}>
                  <option value="">Select category</option>
                  {categoryGroups.map((g) =>
                    g.label ? (
                      <optgroup key={g.label} label={g.label}>
                        {g.items.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      g.items.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))
                    )
                  )}
                </Select>
              </Field>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">
                  Supplier {remaining > 0 ? <span className="text-[var(--danger)]">*</span> : <span className="font-normal text-ink-2">(optional once paid in full)</span>}
                </label>
                <div data-field="supplier" data-opens>
                  <SupplierSelect value={vendorId} options={vendors} onChange={(id) => setVendorId(id)} onAdded={addVendor} disabled={locked} className={`${controlClass} w-full bg-surface text-left`} />
                </div>
              </div>

              <div className="pt-2">
                <SectionTitle>Invoice / supporting document</SectionTitle>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bill type">
                  <Select data-field="billType" disabled={locked} value={billType} onChange={(e) => setBillType(e.target.value as ExpenseBillType)}>
                    {BILL_TYPES.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Invoice number (optional)">
                  <Input data-field="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                </Field>
                <Field label="Invoice date">
                  <DatePicker id="exp-invoiceDate" max={today()} value={invoiceDate} onChange={(v) => setInvoiceDate(v)} className={`${controlClass} w-full`} />
                </Field>
                <Field label="Due date (optional)">
                  <DatePicker id="exp-dueDate" min={invoiceDate || expenseDate} value={dueDate} onChange={(v) => setDueDate(v)} className={`${controlClass} w-full`} />
                </Field>
              </div>
              <BillAvailableToggle value={billAvailable} onChange={setBillAvailable} />
            </section>

            <section className="space-y-3">
              <fieldset disabled={locked} className="min-w-0 space-y-3 border-0 p-0">
                <SectionTitle>Amount and tax</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Taxable amount">
                    <Input type="number" step="0.01" min="0" data-field="taxable" value={taxableAmount} onChange={(e) => setTaxableAmount(e.target.value)} className="text-right" />
                  </Field>
                  <Field label="Tax treatment">
                    <Select data-field="taxTreatment" value={taxTreatment} onChange={(e) => setTaxTreatment(e.target.value as ExpenseTaxTreatment)}>
                      {TAX_TREATMENTS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={`VAT (${vatRate}% default)${billType !== "vat" ? " — VAT bill only" : ""}`}>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      data-field="vat"
                      disabled={billType !== "vat"}
                      value={vatAmount}
                      onChange={(e) => {
                        setVatTouched(true);
                        setVatAmount(e.target.value);
                      }}
                      className="text-right"
                    />
                  </Field>
                  <Field label="Other applicable tax">
                    <Input type="number" step="0.01" min="0" value={otherTaxAmount} onChange={(e) => setOtherTaxAmount(e.target.value)} className="text-right" />
                  </Field>
                  <Field label={`TDS ${tdsHead ? `(${tdsRate}% on this category${fetched.basis ? ` — ${fetched.basis}` : ""})` : "(not on this category)"}`} className="sm:col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      data-field="tds"
                      value={tdsAmount}
                      onChange={(e) => {
                        setTdsTouched(true);
                        setTdsAmount(e.target.value);
                      }}
                      className="text-right"
                    />
                  </Field>
                </div>
              </fieldset>

              <div className="space-y-1 rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink">
                <Line label="Subtotal" value={<Amount value={subtotal} />} />
                <Line label="VAT" value={<Amount value={vat} />} />
                <Line label="Other tax" value={<Amount value={otherTax} />} />
                <Line label="Total expense" value={<Amount value={total} />} className="border-t border-line pt-1 font-medium" />
                <Line label="TDS withheld" value={<span className="tnum">-{tds.toFixed(2)}</span>} className="text-ink-2" />
                <Line label="Amount payable" value={<Amount value={amountPayable} />} className="border-t border-line pt-1 font-semibold" />
              </div>

              <div className="space-y-1 rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink">
                {payments.length === 0 && remaining <= 0 && <p className="text-ink-2">Unpaid</p>}
                {payments.map((p, i) => (
                  <Line key={i} label={accountLabels[p.accountId] ?? "Account"} value={<Amount value={p.amount} />} />
                ))}
                {remaining > 0 && <Line label="Expense Payable (unpaid)" value={<Amount value={remaining} />} />}
                <Line label="Amount payable" value={<Amount value={amountPayable} />} className="border-t border-line pt-1 font-semibold" />
              </div>
            </section>
          </div>
        </div>
      </Modal>

      {dialog}

      {showPayment && (
        <InvoicePaymentModal
          total={amountPayable}
          cashBankAccounts={cashBankAccounts}
          initialLines={payments}
          saving={false}
          onCancel={() => setShowPayment(false)}
          onConfirm={(p) => {
            setPayments(p);
            setShowPayment(false);
          }}
        />
      )}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">{children}</h3>;
}

function Line({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span>{label}</span>
      {value}
    </div>
  );
}
