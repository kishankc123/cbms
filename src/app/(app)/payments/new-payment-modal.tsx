"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPayment,
  getOutstandingInvoicesForCustomer,
  getOutstandingBillsForSupplier,
  getOutstandingExpenses,
  getPaymentFormOptions,
  type PaymentAllocationInput,
} from "./actions";
import { MONEY_IN_TYPE_OPTIONS, MONEY_OUT_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS, ALLOCATABLE_TYPES, TRANSFER_TYPES } from "./payment-types";
import { ConfirmDialog } from "../sales/confirm-dialog";

type FormOptions = Awaited<ReturnType<typeof getPaymentFormOptions>>;
type Direction = "money_in" | "money_out";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => n.toFixed(2);
const inputCls = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const inputErrCls = "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";

function typeConfig(paymentType: string) {
  return {
    needsCustomer: paymentType === "customer_payment" || paymentType === "customer_advance",
    needsVendor: paymentType === "supplier_payment" || paymentType === "supplier_advance",
    optionalVendor: paymentType === "expense_payment" || paymentType === "refund_received",
    optionalOtherParty: ["loan_received", "capital_introduced", "loan_repayment", "owner_withdrawal", "other_receipt", "other_payment"].includes(paymentType),
    noParty: TRANSFER_TYPES.includes(paymentType),
    showAllocation: ALLOCATABLE_TYPES.includes(paymentType),
    showTransferTo: TRANSFER_TYPES.includes(paymentType),
    showCategoryAccount: ["other_receipt", "other_payment", "tax_payment"].includes(paymentType),
  };
}

function flattenAccounts(groups: FormOptions["cashBankAccounts"]) {
  const list: { id: string; label: string }[] = [];
  for (const g of groups) {
    if (g.children.length === 0) list.push({ id: g.id, label: `${g.code} — ${g.name}` });
    else for (const c of g.children) list.push({ id: c.id, label: `${c.code} — ${c.name}` });
  }
  return list;
}

type OutstandingRow = { id: string; label: string; date: string; outstanding: number };

export function NewPaymentModal({
  formOptions,
  onDone,
  onCancel,
  fixedDirection,
}: {
  formOptions: FormOptions;
  onDone: () => void;
  onCancel: () => void;
  fixedDirection?: Direction;
}) {
  const [direction, setDirection] = useState<Direction>(fixedDirection ?? "money_in");
  const [paymentType, setPaymentType] = useState(fixedDirection === "money_out" ? "supplier_payment" : "customer_payment");
  const [paymentDate, setPaymentDate] = useState(today());
  const [accountId, setAccountId] = useState("");
  const [transferToAccountId, setTransferToAccountId] = useState("");
  const [categoryAccountId, setCategoryAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [partyOtherName, setPartyOtherName] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  const [allocated, setAllocated] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const config = typeConfig(paymentType);
  const flatAccounts = useMemo(() => flattenAccounts(formOptions.cashBankAccounts), [formOptions.cashBankAccounts]);
  // Moving money between the business's own accounts now lives in
  // Payments > Inter-Transfer, so it's not offered as a payment type here.
  const typeOptions = direction === "money_in" ? MONEY_IN_TYPE_OPTIONS : MONEY_OUT_TYPE_OPTIONS.filter((t) => !TRANSFER_TYPES.includes(t.value));

  useEffect(() => {
    setPaymentType(direction === "money_in" ? "customer_payment" : "supplier_payment");
    setCustomerId("");
    setVendorId("");
    setOutstanding([]);
    setAllocated({});
  }, [direction]);

  useEffect(() => {
    setOutstanding([]);
    setAllocated({});
    if (paymentType === "customer_payment" && customerId) {
      getOutstandingInvoicesForCustomer(customerId).then((rows) =>
        setOutstanding(rows.map((r) => ({ id: r.id, label: r.invoiceNumber, date: r.invoiceDate, outstanding: r.outstanding })))
      );
    } else if (paymentType === "supplier_payment" && vendorId) {
      getOutstandingBillsForSupplier(vendorId).then((rows) =>
        setOutstanding(rows.map((r) => ({ id: r.id, label: r.billNumber, date: r.billDate, outstanding: r.outstanding })))
      );
    } else if (paymentType === "expense_payment") {
      getOutstandingExpenses(vendorId || null).then((rows) =>
        setOutstanding(rows.map((r) => ({ id: r.id, label: r.expenseNumber, date: r.expenseDate, outstanding: r.outstanding })))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, customerId, vendorId]);

  const allocations: PaymentAllocationInput[] = useMemo(() => {
    const targetType = paymentType === "customer_payment" ? "sales_invoice" : paymentType === "supplier_payment" ? "purchase_bill" : "expense";
    return Object.entries(allocated)
      .filter(([, v]) => (parseFloat(v) || 0) > 0)
      .map(([id, v]) => ({ targetType, targetId: id, allocatedAmount: parseFloat(v) || 0 }));
  }, [allocated, paymentType]);

  const amountNum = parseFloat(amount) || 0;
  const allocatedTotal = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
  const unallocated = Math.max(amountNum - allocatedTotal, 0);

  function toggleAllocation(row: OutstandingRow, checked: boolean) {
    if (paymentType === "expense_payment") {
      // Only one expense can be settled per payment — selecting a new one
      // replaces any previous selection and pins the amount to it exactly.
      setAllocated(checked ? { [row.id]: fmt(Math.min(amountNum || row.outstanding, row.outstanding)) } : {});
      return;
    }
    setAllocated((prev) => {
      const next = { ...prev };
      if (checked) next[row.id] = fmt(Math.min(row.outstanding, Math.max(amountNum - allocatedTotal, 0)) || row.outstanding);
      else delete next[row.id];
      return next;
    });
  }

  async function performSave(confirmDup: boolean) {
    const errors: Record<string, string> = {};
    if (!(amountNum > 0)) errors.amount = "Amount must be greater than zero.";
    if (!paymentDate) errors.paymentDate = "Please enter the payment date.";
    if (!accountId) errors.accountId = "Select an account.";
    if (config.needsCustomer && !customerId) errors.customerId = "Please select a customer.";
    if (config.needsVendor && !vendorId) errors.vendorId = "Please select a supplier.";
    if (config.showTransferTo && !transferToAccountId) errors.transferToAccountId = "Select the destination account.";
    if (paymentMethod === "cheque" && !chequeNumber.trim()) errors.chequeNumber = "Cheque number is required.";
    if (paymentType === "expense_payment" && allocations.length !== 1) errors.allocation = "Select an expense to settle.";
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const result = await createPayment({
        direction,
        paymentType: paymentType as never,
        paymentDate,
        partyType: config.needsCustomer ? "customer" : config.needsVendor || (config.optionalVendor && vendorId) ? "supplier" : config.optionalOtherParty && partyOtherName ? "other" : "none",
        customerId: config.needsCustomer ? customerId : null,
        vendorId: config.needsVendor || config.optionalVendor ? vendorId || null : null,
        partyOtherName: config.optionalOtherParty ? partyOtherName || null : null,
        accountId,
        transferToAccountId: config.showTransferTo ? transferToAccountId : null,
        categoryAccountId: config.showCategoryAccount ? categoryAccountId || null : null,
        paymentMethod: paymentMethod as never,
        chequeNumber: paymentMethod === "cheque" ? chequeNumber : null,
        chequeDate: paymentMethod === "cheque" ? chequeDate || null : null,
        chequeBank: paymentMethod === "cheque" ? chequeBank || null : null,
        referenceNumber: referenceNumber || null,
        amount: amountNum,
        description: description || null,
        notes: notes || null,
        attachmentUrl: attachmentUrl || null,
        allocations: config.showAllocation ? allocations : undefined,
        confirmDuplicate: confirmDup,
      });

      if ("duplicateWarning" in result) {
        setConfirmDuplicate(true);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

      <div className="relative w-full max-w-3xl rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New Payment{fixedDirection ? ` — ${fixedDirection === "money_in" ? "Money In" : "Money Out"}` : ""}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {!fixedDirection && (
          <div className="inline-flex rounded-full bg-gray-100 p-1">
            {(["money_in", "money_out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${direction === d ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {d === "money_in" ? "Money In" : "Money Out"}
              </button>
            ))}
          </div>
        )}

        <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Payment Information</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" max={today()} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={fieldErrors.paymentDate ? inputErrCls : inputCls} />
              {fieldErrors.paymentDate && <p className="mt-1 text-xs text-red-600">{fieldErrors.paymentDate}</p>}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Number</label>
              <input value="Auto-generated on save" disabled className="w-full rounded bg-gray-50 px-2 py-1.5 text-sm text-gray-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
              <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className={inputCls}>
                {typeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{config.showTransferTo ? "From Account" : "Account"}</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={fieldErrors.accountId ? inputErrCls : inputCls}>
                <option value="">Select account</option>
                {flatAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              {fieldErrors.accountId && <p className="mt-1 text-xs text-red-600">{fieldErrors.accountId}</p>}
            </div>

            {config.showTransferTo && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">To Account</label>
                <select value={transferToAccountId} onChange={(e) => setTransferToAccountId(e.target.value)} className={fieldErrors.transferToAccountId ? inputErrCls : inputCls}>
                  <option value="">Select account</option>
                  {flatAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.transferToAccountId && <p className="mt-1 text-xs text-red-600">{fieldErrors.transferToAccountId}</p>}
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {paymentMethod === "cheque" && (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cheque Number</label>
                  <input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className={fieldErrors.chequeNumber ? inputErrCls : inputCls} />
                  {fieldErrors.chequeNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.chequeNumber}</p>}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cheque Date</label>
                  <input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Bank</label>
                  <input value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} className={inputCls} />
                </div>
              </>
            )}
            {(paymentMethod === "bank_transfer" || paymentMethod === "online" || paymentMethod === "card") && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reference Number</label>
                <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className={inputCls} />
              </div>
            )}

            {config.needsCustomer && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Customer</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldErrors.customerId ? inputErrCls : inputCls}>
                  <option value="">Select customer</option>
                  {formOptions.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.customerId && <p className="mt-1 text-xs text-red-600">{fieldErrors.customerId}</p>}
              </div>
            )}
            {(config.needsVendor || config.optionalVendor) && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Supplier{config.optionalVendor ? " (optional)" : ""}</label>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={fieldErrors.vendorId ? inputErrCls : inputCls}>
                  <option value="">{config.optionalVendor ? "No supplier" : "Select supplier"}</option>
                  {formOptions.vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.vendorId && <p className="mt-1 text-xs text-red-600">{fieldErrors.vendorId}</p>}
              </div>
            )}
            {config.optionalOtherParty && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Party (optional)</label>
                <input value={partyOtherName} onChange={(e) => setPartyOtherName(e.target.value)} placeholder="e.g. lender, owner, description" className={inputCls} />
              </div>
            )}
            {config.showCategoryAccount && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Classification Account</label>
                <select value={categoryAccountId} onChange={(e) => setCategoryAccountId(e.target.value)} className={inputCls}>
                  <option value="">
                    {paymentType === "tax_payment" ? "Default: Tax Payable" : direction === "money_in" ? "Default: Other Income" : "Default: Miscellaneous Expense"}
                  </option>
                  {(paymentType === "tax_payment" ? formOptions.taxAccounts : direction === "money_in" ? formOptions.incomeAccounts : formOptions.expenseAccounts).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldErrors.amount ? inputErrCls : inputCls} />
              {fieldErrors.amount && <p className="mt-1 text-xs text-red-600">{fieldErrors.amount}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Internal Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Attachment reference (URL or filename)</label>
            <input value={attachmentUrl} onChange={(e) => setAttachmentUrl(e.target.value)} placeholder="No file upload yet — paste a link or reference" className={inputCls} />
          </div>
        </section>

        {config.showAllocation && (
          <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Accounting / Allocation Information</h3>

            {((paymentType === "customer_payment" && !customerId) || (paymentType === "supplier_payment" && !vendorId)) && (
              <p className="text-sm text-gray-400">Select a {paymentType === "customer_payment" ? "customer" : "supplier"} to see outstanding balances.</p>
            )}

            {outstanding.length === 0 && ((paymentType === "customer_payment" && customerId) || (paymentType === "supplier_payment" && vendorId) || paymentType === "expense_payment") && (
              <p className="text-sm text-gray-400">No outstanding {paymentType === "expense_payment" ? "expenses" : paymentType === "customer_payment" ? "invoices" : "bills"} found.</p>
            )}

            {outstanding.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 text-xs"></th>
                      <th className="px-2 py-1.5 text-xs">No.</th>
                      <th className="px-2 py-1.5 text-xs">Date</th>
                      <th className="px-2 py-1.5 text-xs text-right">Outstanding</th>
                      <th className="px-2 py-1.5 text-xs text-right">Allocate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.map((row) => {
                      const checked = row.id in allocated;
                      return (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="px-2 py-1">
                            <input type="checkbox" checked={checked} onChange={(e) => toggleAllocation(row, e.target.checked)} />
                          </td>
                          <td className="px-2 py-1 font-mono text-xs">{row.label}</td>
                          <td className="px-2 py-1 text-gray-500">{row.date}</td>
                          <td className="px-2 py-1 text-right">{fmt(row.outstanding)}</td>
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!checked}
                              value={allocated[row.id] ?? ""}
                              onChange={(e) => setAllocated((prev) => ({ ...prev, [row.id]: e.target.value }))}
                              className="w-24 rounded border border-gray-300 bg-white px-1.5 py-1 text-sm text-right disabled:bg-gray-50"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {fieldErrors.allocation && <p className="text-xs text-red-600">{fieldErrors.allocation}</p>}

            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-gray-500">Payment Amount </span>
                <span className="font-medium text-gray-900">{fmt(amountNum)}</span>
              </div>
              <div>
                <span className="text-gray-500">Allocated </span>
                <span className="font-medium text-gray-900">{fmt(allocatedTotal)}</span>
              </div>
              <div>
                <span className="text-gray-500">Unallocated {paymentType !== "expense_payment" && "(→ advance)"} </span>
                <span className="font-medium text-gray-900">{fmt(unallocated)}</span>
              </div>
            </div>
          </section>
        )}

        <div className="flex items-center justify-end gap-3">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button type="button" onClick={onCancel} disabled={saving} className="rounded text-gray-500 hover:text-gray-700 text-sm px-2 py-1.5 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => performSave(false)}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium px-5 py-1.5 disabled:opacity-50"
          >
            {saving ? "Posting..." : "Post Payment"}
          </button>
        </div>
      </div>

      {confirmDuplicate && (
        <ConfirmDialog
          message="A very similar payment (same party/amount/reference) was recorded recently. Post it anyway?"
          onYes={() => {
            setConfirmDuplicate(false);
            performSave(true);
          }}
          onNo={() => setConfirmDuplicate(false)}
        />
      )}
    </div>
  );
}
