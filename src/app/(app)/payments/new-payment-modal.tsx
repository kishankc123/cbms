"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { okToChange } from "../suppliers/reconcile/confirm-change";
import {
  createPayment,
  updatePayment,
  getPaymentDetail,
  getOutstandingExpenses, getOpenPayableOptions,
  getPaymentFormOptions,
  getCustomerRefundable,
  getEmployeeOwed,
  getEmployeeAdvanceInfo,
  type PaymentAllocationInput,
} from "./actions";
import { MONEY_IN_TYPE_OPTIONS, MONEY_OUT_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS, PAYMENT_TYPE_LABELS, ALLOCATABLE_TYPES, TRANSFER_TYPES } from "./payment-types";
import { ConfirmDialog } from "../sales/confirm-dialog";
import { SavedScreen } from "@/components/saved-screen";
import { Amount } from "@/components/ui/data-table";
import { useProblem } from "@/components/problem-dialog";
import { LedgerSelect, PaymentModeSelect, useLedgerOptions } from "@/components/payment-mode-select";
import { methodForMode } from "@/lib/payment-mode-rules";
import { getPayableTaxItems, recordObligationPayment } from "../compliance/tax-actions";
import { HeadSplitFields, shareAcross, splitAmounts, splitHeadings, splitTotal, startingSplit, type HeadSplit } from "../compliance/tax/heading-split";

import { DatePicker } from "@/components/calendar/date-picker";
import { monthNames, todayIso, ymdOf } from "@/lib/calendar";
import { useCalendar } from "@/components/calendar/calendar-provider";
import { D } from "@/components/calendar/date-text";
import { AmountInput } from "@/components/ui/amount-input";
type FormOptions = Awaited<ReturnType<typeof getPaymentFormOptions>>;
/** A payment being edited: the detail the drawer shows, which carries everything the form needs. */
export type EditingPayment = Awaited<ReturnType<typeof getPaymentDetail>>;
type Direction = "money_in" | "money_out";

const today = () => todayIso();
const fmt = (n: number) => n.toFixed(2);
const inputCls = "w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";
const inputErrCls = "w-full rounded border border-red-400 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400";

function typeConfig(paymentType: string) {
  return {
    needsCustomer: paymentType === "customer_payment" || paymentType === "customer_advance" || paymentType === "customer_refund",
    needsEmployee: paymentType === "salary_payment" || paymentType === "staff_advance",
    needsAdvanceMonth: paymentType === "staff_advance",
    needsVendor: paymentType === "supplier_payment" || paymentType === "supplier_advance",
    optionalVendor: paymentType === "expense_payment" || paymentType === "refund_received",
    optionalOtherParty: ["ledger_receipt", "ledger_payment", "loan_received", "capital_introduced", "loan_repayment", "owner_withdrawal", "other_receipt", "other_payment"].includes(paymentType),
    noParty: TRANSFER_TYPES.includes(paymentType),
    showAllocation: ALLOCATABLE_TYPES.includes(paymentType),
    showTransferTo: TRANSFER_TYPES.includes(paymentType),
    showCategoryAccount: ["other_receipt", "other_payment", "tax_payment"].includes(paymentType),
    // Money from or to a ledger account: the cash or bank side is chosen as usual, and the ledger account is the other side.
    needsLedgerAccount: paymentType === "ledger_receipt" || paymentType === "ledger_payment",
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

type TaxItem = Awaited<ReturnType<typeof getPayableTaxItems>>[number];
type OutstandingRow = { id: string; label: string; date: string; outstanding: number };

/** What the next new payment starts with after one is saved: a day's payments usually share the date, the kind of payment and how it was paid. */
type Carry = { paymentDate: string; direction: Direction; paymentType: string; accountId: string; paymentModeId: string; paymentModeName: string };
type Saved = { number: string; date: string; type: string; party: string; via: string; amount: number; carry: Carry };

// A new payment: after it is posted the form is replaced by a confirmation with ways to carry on, so a day's payments can be entered one after another.
// Editing a payment, or recording one against a bank line being reconciled, closes as before.
export function NewPaymentModal(props: Omit<Parameters<typeof PaymentForm>[0], "carry" | "onAnother">) {
  const [run, setRun] = useState<{ n: number; carry?: Carry }>({ n: 0 });
  return <PaymentForm key={run.n} {...props} carry={run.carry} onAnother={(carry) => setRun((r) => ({ n: r.n + 1, carry }))} />;
}

function PaymentForm({
  formOptions,
  onDone,
  onCancel,
  fixedDirection,
  editing,
  prefill,
  carry,
  onAnother,
}: {
  formOptions: FormOptions;
  onDone: () => void;
  onCancel: () => void;
  fixedDirection?: Direction;
  /** When given, the form edits this payment (its kind cannot change) instead of recording a new one. */
  editing?: EditingPayment;
  /** Opens a new payment with these filled in (from a bank line being reconciled). */
  prefill?: { amount: number; date: string; accountId: string; /** From a supplier's statement or a bill: the supplier, their document number and what it was for. */ vendorId?: string; /** From an invoice: the customer paying. */ customerId?: string; referenceNumber?: string; description?: string };
  carry?: Carry;
  onAnother: (carry?: Carry) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [direction, setDirection] = useState<Direction>(editing?.direction ?? fixedDirection ?? carry?.direction ?? "money_in");
  const [paymentType, setPaymentType] = useState<string>(editing?.paymentType ?? carry?.paymentType ?? (fixedDirection === "money_out" ? "supplier_payment" : "customer_payment"));
  const [paymentDate, setPaymentDate] = useState(editing?.paymentDate ?? prefill?.date ?? carry?.paymentDate ?? today());
  const [accountId, setAccountId] = useState(editing?.accountId ?? prefill?.accountId ?? carry?.accountId ?? "");
  // A payment is settled either through cash, bank or a wallet (the mode field) or through a ledger account (its own field, below the party).
  const ledgerOptions = useLedgerOptions();
  const ledgerChosen = ledgerOptions.some((a) => a.id === accountId);
  const [paymentModeId, setPaymentModeId] = useState(editing?.paymentModeId ?? carry?.paymentModeId ?? "");
  const [paymentModeName, setPaymentModeName] = useState(editing?.paymentModeName ?? carry?.paymentModeName ?? "");
  const [transferToAccountId, setTransferToAccountId] = useState(editing?.transferToAccountId ?? "");
  const [categoryAccountId, setCategoryAccountId] = useState(editing?.categoryAccountId ?? "");
  const [chequeNumber, setChequeNumber] = useState(editing?.chequeNumber ?? "");
  const [chequeDate, setChequeDate] = useState(editing?.chequeDate ?? "");
  const [chequeBank, setChequeBank] = useState(editing?.chequeBank ?? "");
  const [referenceNumber, setReferenceNumber] = useState(editing?.referenceNumber ?? prefill?.referenceNumber ?? "");
  const [customerId, setCustomerId] = useState(editing?.customerId ?? prefill?.customerId ?? "");
  const [vendorId, setVendorId] = useState(editing?.vendorId ?? prefill?.vendorId ?? "");
  const [employeeId, setEmployeeId] = useState(editing?.employeeId ?? "");
  const [owed, setOwed] = useState<number | null>(null);
  // A staff advance is taken against a payroll month of the organization's calendar; it opens on the current month.
  const calendar = useCalendar();
  const currentMonth = ymdOf(calendar, todayIso()) ?? ymdOf("AD", todayIso())!;
  // 0 = left to the system: the advance is recovered from the month of its date.
  const [advMonth, setAdvMonth] = useState(editing?.advanceMonth?.month ?? 0);
  const [advYear, setAdvYear] = useState(editing?.advanceMonth?.year ?? currentMonth.year);
  const [advInfo, setAdvInfo] = useState<{ outstanding: number; basic: number } | null>(null);
  const [partyOtherName, setPartyOtherName] = useState(editing?.partyOtherName ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : prefill ? prefill.amount.toFixed(2) : "");
  const [description, setDescription] = useState(editing?.description ?? prefill?.description ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [attachmentUrl, setAttachmentUrl] = useState(editing?.attachmentUrl ?? "");
  // A payment that has been reconciled keeps its date, amount and payment account; the rest can still change, and moving it to another party or category needs a reason.
  const lockedRecon = editing?.reconciliationStatus === "reconciled";
  const [changeReason, setChangeReason] = useState("");

  const [refundable, setRefundable] = useState<{ credit: number; total: number } | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  const [allocated, setAllocated] = useState<Record<string, string>>({});
  // True while the amount was filled in from the ticked expenses, so it keeps following them until the person types an amount of their own.
  const amountAuto = useRef(false);

  // A new Tax Payment is made to one of the tax items still owing; a TDS item is paid by heading, each heading clearing its own payable account.
  const [taxItems, setTaxItems] = useState<TaxItem[]>([]);
  const [taxItemId, setTaxItemId] = useState("");
  const [headSplit, setHeadSplit] = useState<HeadSplit>({});
  const taxItem = taxItems.find((t) => t.id === taxItemId) ?? null;
  const headings = splitHeadings(taxItem?.breakdown);

  const [saving, setSaving] = useState(false);
  // Problems are shown in a dialog that says why; closing it puts the cursor in the field that needs attention.
  const { report, dialog } = useProblem();
  const ask = useConfirm();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  // The payment method on the record follows the mode picked (Cheque brings the cheque fields).
  const paymentMethod = paymentModeName ? methodForMode(paymentModeName) : editing ? editing.paymentMethod : "cash";
  const config = typeConfig(paymentType);
  const flatAccounts = useMemo(() => flattenAccounts(formOptions.cashBankAccounts), [formOptions.cashBankAccounts]);
  // Moving money between the business's own accounts now lives in
  // Payments > Inter-Transfer, so it's not offered as a payment type here.
  const typeOptions = direction === "money_in" ? MONEY_IN_TYPE_OPTIONS : MONEY_OUT_TYPE_OPTIONS.filter((t) => !TRANSFER_TYPES.includes(t.value));

  // The kind of payment follows the direction, except on the first run of a payment that carries the last one's kind over.
  const firstRun = useRef(true);
  useEffect(() => {
    const keep = firstRun.current && Boolean(carry || prefill?.vendorId || prefill?.customerId);
    firstRun.current = false;
    if (editing || keep) return; // an edit keeps the kind of payment it has
    setPaymentType(direction === "money_in" ? "customer_payment" : "supplier_payment");
    setCustomerId("");
    setVendorId("");
    setEmployeeId("");
    setOutstanding([]);
    setAllocated({});
  }, [direction]);

  useEffect(() => {
    setOutstanding([]);
    setAllocated({});
    // Back on the party the payment was recorded for, an edit starts with what it already settles ticked.
    const seedOwn = () => {
      if (editing && customerId === (editing.customerId ?? "") && vendorId === (editing.vendorId ?? "")) {
        setAllocated(Object.fromEntries(editing.allocations.map((a) => [a.targetId, fmt(a.allocatedAmount)])));
      }
    };
    if (paymentType === "expense_payment") {
      getOutstandingExpenses(vendorId || null, editing?.id).then((rows) => {
        setOutstanding(rows.map((r) => ({ id: r.id, label: r.expenseNumber, date: r.expenseDate, outstanding: r.outstanding })));
        seedOwn();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType, customerId, vendorId]);

  useEffect(() => {
    setTaxItemId("");
    if (paymentType === "tax_payment" && !editing) getPayableTaxItems().then(setTaxItems).catch(() => setTaxItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType]);

  function chooseTaxItem(id: string) {
    const item = taxItems.find((t) => t.id === id);
    const split = startingSplit(splitHeadings(item?.breakdown));
    setTaxItemId(id);
    setHeadSplit(split);
    setAmount(!item ? "" : item.breakdown ? splitTotal(splitHeadings(item.breakdown), split).toFixed(2) : item.balance.toFixed(2));
  }
  function changeSplit(next: HeadSplit) {
    setHeadSplit(next);
    setAmount(splitTotal(headings, next).toFixed(2));
  }

  useEffect(() => {
    setRefundable(null);
    if (paymentType === "customer_refund" && customerId) getCustomerRefundable(customerId).then(setRefundable).catch(() => setRefundable(null));
  }, [paymentType, customerId]);

  useEffect(() => {
    setOwed(null);
    setAdvInfo(null);
    if (paymentType === "salary_payment" && employeeId) getEmployeeOwed(employeeId).then((r) => setOwed(r.balance)).catch(() => setOwed(null));
    if (paymentType === "staff_advance" && employeeId) getEmployeeAdvanceInfo(employeeId).then(setAdvInfo).catch(() => setAdvInfo(null));
  }, [paymentType, employeeId]);

  const allocations: PaymentAllocationInput[] = useMemo(() => {
    const targetType = "expense" as const;
    return Object.entries(allocated)
      .filter(([, v]) => (parseFloat(v) || 0) > 0)
      .map(([id, v]) => ({ targetType, targetId: id, allocatedAmount: parseFloat(v) || 0 }));
  }, [allocated, paymentType]);

  // Expense payables with an opening balance still owed, which a ledger payment can clear (no expense bill stands behind them).
  const [openOwed, setOpenOwed] = useState<Awaited<ReturnType<typeof getOpenPayableOptions>>>([]);
  useEffect(() => {
    if (paymentType !== "ledger_payment") return;
    getOpenPayableOptions(editing?.id)
      .then(setOpenOwed)
      .catch(() => setOpenOwed([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentType]);

  /** What "Paid to / Received from ledger account" offers: the usual ledger accounts and, for money out, the payables with an opening balance still due. */
  const ledgerChoices =
    direction === "money_out"
      ? [...ledgerOptions, ...openOwed.map((o) => ({ id: o.id, code: o.code, name: `${o.name} (opening balance due ${fmt(o.unbilled)})`, category: "liability", group: o.group, groupCode: o.groupCode }))]
      : ledgerOptions;

  // The page behind does not scroll while the window is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const amountNum = parseFloat(amount) || 0;
  const allocatedTotal = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
  const unallocated = Math.max(amountNum - allocatedTotal, 0);

  function toggleAllocation(row: OutstandingRow, checked: boolean) {
    // Several expenses can be settled by one payment: each ticked one takes what is left of the amount, up to what it owes, and the rest of what it owes stays
    // outstanding. With no amount typed yet, a ticked expense takes all it owes and the amount follows the total.
    const next = { ...allocated };
    if (checked) next[row.id] = fmt(amountNum > 0 ? Math.min(row.outstanding, Math.max(amountNum - allocatedTotal, 0)) : row.outstanding);
    else delete next[row.id];
    setAllocated(next);
    if (amountNum === 0 || amountAuto.current) {
      const total = Object.values(next).reduce((s, v) => s + (parseFloat(v) || 0), 0);
      setAmount(total > 0 ? fmt(total) : "");
      amountAuto.current = total > 0;
    }
  }

  // A new payment shows what was posted; one made from a bank line being reconciled closes, as the reconciliation carries on from there.
  function finish(number: string) {
    if (prefill) return onDone();
    const party = config.needsCustomer ? formOptions.customers.find((c) => c.id === customerId)?.name : config.needsEmployee ? formOptions.employees.find((e) => e.id === employeeId)?.name : config.needsVendor || (config.optionalVendor && vendorId) ? formOptions.vendors.find((v) => v.id === vendorId)?.name : config.optionalOtherParty ? partyOtherName : "";
    const ledger = ledgerOptions.find((a) => a.id === accountId);
    const via = ledger ? `${ledger.code} — ${ledger.name}` : paymentModeName || flatAccounts.find((a) => a.id === accountId)?.label || "";
    router.refresh();
    setSaved({
      number,
      date: paymentDate,
      type: PAYMENT_TYPE_LABELS[paymentType] ?? paymentType,
      party: party ?? "",
      via,
      amount: amountNum,
      carry: { paymentDate, direction, paymentType, accountId, paymentModeId, paymentModeName },
    });
  }

  async function performSave(confirmDup: boolean) {
    const errors: Record<string, string> = {};
    const first: { message: string; target: string }[] = [];
    const bad = (key: string, message: string, target: string) => {
      errors[key] = message;
      first.push({ message, target });
    };
    if (!paymentDate) bad("paymentDate", "Please enter the payment date.", "#pay-date");
    if (config.needsLedgerAccount && !ledgerChoices.some((l) => l.id === categoryAccountId)) bad("categoryAccountId", "Choose the ledger account the money comes from or goes to.", '[data-field="ledger"]');
    if (!accountId || ((config.showTransferTo || config.needsLedgerAccount) && ledgerChosen)) bad("accountId", config.showTransferTo ? "Select the payment mode and the account the money moves through." : "Select the payment mode and account, or settle through a ledger account.", '[data-field="account"]');
    if (config.showTransferTo && !transferToAccountId) bad("transferToAccountId", "Select the destination account.", '[data-field="transferTo"]');
    if (config.needsCustomer && !customerId) bad("customerId", "Please select a customer.", '[data-field="customer"]');
    if (config.needsVendor && !vendorId) bad("vendorId", "Please select a supplier.", '[data-field="vendor"]');
    if (config.needsAdvanceMonth && advMonth && !advYear) bad("advanceMonth", "Enter the year of the month this advance is for.", '[data-field="advance-month"]');
    if (config.needsEmployee && !employeeId) bad("employeeId", "Please select an employee.", '[data-field="employee"]');
    if (!(amountNum > 0)) bad("amount", "Amount must be greater than zero.", '[data-field="amount"]');
    if (paymentMethod === "cheque" && !chequeNumber.trim()) bad("chequeNumber", "Cheque number is required for a cheque payment.", '[data-field="cheque"]');
    if (paymentType === "expense_payment" && allocations.length < 1) bad("allocation", "Select the expense this payment settles.", '[data-field="allocation"]');
    else if (paymentType === "expense_payment" && Math.abs(allocatedTotal - amountNum) > 0.005) bad("allocation", `The payment is ${fmt(amountNum)} but ${fmt(allocatedTotal)} is allocated. Allocate the whole amount across the expenses.`, '[data-field="allocation"]');
    setFieldErrors(errors);
    if (first.length > 0) return report(first[0].message, first[0].target);

    if (editing && !(await okToChange(ask, "payment", editing.id))) return;
    setSaving(true);
    try {
      const fields = {
        paymentDate,
        partyType: (config.needsEmployee ? "employee" : config.needsCustomer ? "customer" : config.needsVendor || (config.optionalVendor && vendorId) ? "supplier" : config.optionalOtherParty && partyOtherName ? "other" : "none") as "customer" | "supplier" | "employee" | "other" | "none",
        customerId: config.needsCustomer ? customerId : null,
        employeeId: config.needsEmployee ? employeeId : null,
        advanceMonth: config.needsAdvanceMonth && advMonth ? { calendar, month: advMonth, year: advYear } : null,
        vendorId: config.needsVendor || config.optionalVendor ? vendorId || null : null,
        partyOtherName: config.optionalOtherParty ? partyOtherName || null : null,
        accountId,
        paymentModeId: paymentModeId || null,
        transferToAccountId: config.showTransferTo ? transferToAccountId : null,
        categoryAccountId: config.showCategoryAccount || config.needsLedgerAccount ? categoryAccountId || null : null,
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
      };

      if (taxItem && !editing) {
        const r = await recordObligationPayment({
          obligationId: taxItem.id,
          amount: amountNum,
          headAmounts: headings.length > 0 ? splitAmounts(headings, headSplit) : undefined,
          paymentDate,
          accountId,
          paymentModeId: paymentModeId || null,
          paymentMethod: paymentMethod as never,
          referenceNumber: referenceNumber || "",
          chequeNumber: paymentMethod === "cheque" ? chequeNumber : undefined,
          description: description || undefined,
          notes: notes || undefined,
          confirmDuplicate: confirmDup,
        });
        if (r.duplicateWarning) {
          setConfirmDuplicate(true);
          return;
        }
        finish(r.paymentNumber);
        return;
      }

      if (editing) {
        // A tax payment (no allocation section here) keeps the compliance items it settles; an older customer or supplier payment's
        // invoice links are dropped — what it settles now follows the party's ledger.
        const result = await updatePayment(editing.id, {
          ...fields,
          reason: lockedRecon ? changeReason.trim() : undefined,
          allocations: config.showAllocation ? allocations : editing.allocations.filter((a) => a.targetType === "tax_obligation").map((a) => ({ targetType: "tax_obligation" as const, targetId: a.targetId, allocatedAmount: a.allocatedAmount, tdsHeadKey: a.tdsHeadKey })),
        });
        if (!result.changed) {
          report("Nothing was changed, so there is nothing to save.", null);
          return;
        }
        onDone();
        return;
      }

      const result = await createPayment({ ...fields, direction, paymentType: paymentType as never, confirmDuplicate: confirmDup });
      if ("duplicateWarning" in result) {
        setConfirmDuplicate(true);
        return;
      }
      finish(result.paymentNumber);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save payment";
      const rules: [RegExp, string][] = [
        [/closed period|payment date/i, "#pay-date"],
        [/owed|credit to refund|isn't owed/i, '[data-field="amount"]'],
        [/classification/i, '[data-field="category"]'],
        [/Cash or Bank|account/i, '[data-field="account"]'],
        [/different (customer|supplier)|allocat|invoice|bill|expense/i, '[data-field="allocation"]'],
        [/month|payroll/i, '[data-field="advance-month"]'],
        [/employee|salary|joined|left/i, '[data-field="employee"]'],
        [/customer/i, '[data-field="customer"]'],
        [/supplier/i, '[data-field="vendor"]'],
        [/amount/i, '[data-field="amount"]'],
        [/cheque/i, '[data-field="cheque"]'],
      ];
      report(message, rules.find(([re]) => re.test(message))?.[1] ?? null);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <SavedScreen
        title="Payment saved"
        number={saved.number}
        rows={[
          { label: "Date", value: <D value={saved.date} /> },
          { label: "Type", value: saved.type },
          ...(saved.party ? [{ label: saved.carry.direction === "money_in" ? "From" : "To", value: saved.party }] : []),
          ...(saved.via ? [{ label: "Through", value: saved.via }] : []),
          { label: "Amount", value: <Amount value={saved.amount} /> },
        ]}
        onDone={onDone}
        onAnother={() => onAnother()}
        onSameDate={() => onAnother(saved.carry)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onCancel} />

      {/* my-auto centres it when it fits and starts at the top when it is taller than the screen; the title and the buttons stay in view while the middle scrolls. */}
      <div className="relative my-auto max-h-[calc(100vh-2rem)] w-full max-w-3xl space-y-4 overflow-y-auto rounded-[var(--radius-modal)] border border-line bg-surface p-5 shadow-[var(--shadow-modal)]">
        <div className="sticky top-0 z-10 -mx-5 -mt-5 flex items-center justify-between border-b border-line bg-surface px-5 pb-3 pt-4">
          <h2 className="text-base font-semibold text-gray-900">{editing ? `Edit Payment ${editing.paymentNumber}` : `New Payment${fixedDirection ? ` — ${fixedDirection === "money_in" ? "Money In" : "Money Out"}` : ""}`}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {lockedRecon && (
          <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning-text)]">
            This payment has been reconciled, so its date, amount and payment account are locked. You can still change the party, category, reference, cheque details, description and notes. Moving it to another party or category is recorded as a small entry, with your reason.
          </div>
        )}

        {!fixedDirection && !editing && (
          <div className="flex gap-1 overflow-x-auto border-b border-line">
            {(["money_in", "money_out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${direction === d ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
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
              <DatePicker id="pay-date" max={today()} value={paymentDate} onChange={(v) => setPaymentDate(v)} disabled={lockedRecon} className={fieldErrors.paymentDate ? inputErrCls : inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Number</label>
              <input value={editing ? editing.paymentNumber : "Auto-generated on save"} disabled className="w-full rounded bg-gray-50 px-2 py-1.5 text-sm text-gray-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
              <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} disabled={Boolean(editing)} title={editing ? "The kind of payment cannot be changed in an edit" : undefined} className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-500`}>
                {typeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{config.showTransferTo ? "From Account" : "Mode and Account"}</label>
              <div data-field="account">
                <PaymentModeSelect
                  value={{ modeId: paymentModeId, accountId: ledgerChosen ? "" : accountId, modeName: paymentModeName }}
                  onChange={(v) => {
                    setPaymentModeId(v.modeId);
                    setPaymentModeName(v.modeName ?? "");
                    setAccountId(v.accountId);
                  }}
                  disabled={lockedRecon}
                  className={fieldErrors.accountId ? inputErrCls : inputCls}
                />
              </div>
            </div>

            {config.showTransferTo && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">To Account</label>
                <select data-field="transferTo" value={transferToAccountId} onChange={(e) => setTransferToAccountId(e.target.value)} disabled={lockedRecon} className={fieldErrors.transferToAccountId ? inputErrCls : inputCls}>
                  <option value="">Select account</option>
                  {flatAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            
            {paymentMethod === "cheque" && (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cheque Number</label>
                  <input data-field="cheque" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} className={fieldErrors.chequeNumber ? inputErrCls : inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cheque Date</label>
                  <DatePicker value={chequeDate} onChange={(v) => setChequeDate(v)} className={inputCls} />
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
                <select data-field="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldErrors.customerId ? inputErrCls : inputCls}>
                  <option value="">Select customer</option>
                  {formOptions.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {paymentType === "customer_refund" && refundable && (
                  <p className="mt-1 text-xs text-gray-500">
                    Can be refunded: {fmt(refundable.total)}
                  </p>
                )}
              </div>
            )}
            {config.needsEmployee && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employee</label>
                <select data-field="employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={fieldErrors.employeeId ? inputErrCls : inputCls}>
                  <option value="">Select employee</option>
                  {formOptions.employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                {paymentType === "salary_payment" &&
                  owed !== null &&
                  (() => {
                    // In an edit the saved payment is already on the account, so it is added back to show what was owed without it.
                    const balance = owed + (editing?.paymentType === "salary_payment" && editing.employeeId === employeeId ? Number(editing.amount) : 0);
                    const over = amountNum - Math.max(balance, 0);
                    return (
                      <>
                        <p className="mt-1 text-xs text-gray-500">{balance < -0.004 ? `This employee owes you ${fmt(-balance)} (advances and anything overpaid)` : `Owed to this employee: ${fmt(balance)}`}</p>
                        {over > 0.004 && <p className="mt-1 text-xs text-amber-700">This is {fmt(over)} more than is owed. It will save, and the account will show it as owed back to you.</p>}
                      </>
                    );
                  })()}
                {paymentType === "staff_advance" && advInfo && (
                  <p className={`mt-1 text-xs ${advInfo.outstanding + amountNum > advInfo.basic && advInfo.basic > 0 ? "text-amber-700" : "text-gray-500"}`}>
                    Advances not yet recovered: {fmt(advInfo.outstanding)} · Monthly basic: {fmt(advInfo.basic)}
                    {advInfo.basic > 0 && advInfo.outstanding + amountNum > advInfo.basic ? " — this would take their advances above one month's basic salary" : ""}
                  </p>
                )}
              </div>
            )}
            {config.needsAdvanceMonth && (
              <div data-field="advance-month">
                <label className="block text-xs text-gray-500 mb-1">Recover from month (optional)</label>
                <div className="flex gap-2">
                  <select value={advMonth} onChange={(e) => setAdvMonth(Number(e.target.value))} className={inputCls}>
                    <option value={0}>Automatic: the month of the date</option>
                    {monthNames(calendar).map((name, i) => (
                      <option key={i} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {advMonth > 0 && <input type="number" value={advYear} onChange={(e) => setAdvYear(Number(e.target.value))} className={`${inputCls} w-24`} />}
                </div>
                <p className="mt-1 text-xs text-gray-500">{advMonth > 0 ? "Recovered from that month's salary sheet." : "Recovered from the salary sheet of the month the advance is dated in. Choose a month only to push it later."}</p>
              </div>
            )}
            {(config.needsVendor || config.optionalVendor) && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Supplier{config.optionalVendor ? " (optional)" : ""}</label>
                <select data-field="vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={fieldErrors.vendorId ? inputErrCls : inputCls}>
                  <option value="">{config.optionalVendor ? "No supplier" : "Select supplier"}</option>
                  {formOptions.vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {config.optionalOtherParty && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Party (optional)</label>
                <input value={partyOtherName} onChange={(e) => setPartyOtherName(e.target.value)} placeholder="e.g. lender, owner, description" className={inputCls} />
              </div>
            )}
            {config.needsLedgerAccount && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">{direction === "money_in" ? "Received from ledger account" : "Paid to ledger account"}</label>
                <div data-field="ledger">
                  <LedgerSelect accounts={ledgerChoices} value={categoryAccountId} onChange={setCategoryAccountId} className={fieldErrors.categoryAccountId ? inputErrCls : inputCls} />
                </div>
              </div>
            )}
            {!config.showTransferTo && !config.needsLedgerAccount && ledgerOptions.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Settle through ledger account</label>
                <LedgerSelect
                  accounts={ledgerOptions}
                  value={ledgerChosen ? accountId : ""}
                  onChange={(id) => {
                    // Choosing a ledger account replaces the mode and account above; clearing it leaves the payment to be set there.
                    setPaymentModeId("");
                    setPaymentModeName("");
                    setAccountId(id);
                  }}
                  disabled={lockedRecon}
                  className={fieldErrors.accountId && !accountId ? inputErrCls : inputCls}
                />
              </div>
            )}
            {paymentType === "tax_payment" && !editing && taxItems.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Pay to</label>
                <select data-field="taxItem" value={taxItemId} onChange={(e) => chooseTaxItem(e.target.value)} className={inputCls}>
                  <option value="">Other (no tax item)</option>
                  {taxItems.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} · {fmt(t.balance)} left
                    </option>
                  ))}
                </select>
              </div>
            )}
            {config.showCategoryAccount && !taxItem && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Classification Account</label>
                <select data-field="category" value={categoryAccountId} onChange={(e) => setCategoryAccountId(e.target.value)} className={inputCls}>
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
              <AmountInput bare data-field="amount" type="number" step="0.01" min="0" disabled={lockedRecon} value={amount} onChange={(e) => (headings.length > 0 ? changeSplit(shareAcross(headings, Number(e.target.value) || 0)) : (amountAuto.current = false, setAmount(e.target.value)))} className={fieldErrors.amount ? inputErrCls : inputCls} />
            </div>
            {headings.length > 0 && <HeadSplitFields headings={headings} split={headSplit} onChange={changeSplit} inputClass={inputCls} />}
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
          {lockedRecon && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reason for the change</label>
              <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Needed if you change the party, category or what it settles" className={inputCls} />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Attachment reference (URL or filename)</label>
            <input value={attachmentUrl} onChange={(e) => setAttachmentUrl(e.target.value)} placeholder="No file upload yet — paste a link or reference" className={inputCls} />
          </div>
        </section>

        {config.showAllocation && (
          <section data-field="allocation" className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Expenses this payment settles</h3>
            <p className="-mt-1 text-xs text-ink-2">Tick one or more. The amount you allocate to each reduces what it owes; anything not allocated to an expense stays outstanding on it.</p>

            {outstanding.length === 0 && <p className="text-sm text-gray-400">No outstanding expenses found.</p>}

            {outstanding.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-ink-2 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-app">
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
                        <tr key={row.id} className="border-b border-line transition-colors hover:bg-hover">
                          <td className="px-2 py-1">
                            <input type="checkbox" checked={checked} onChange={(e) => toggleAllocation(row, e.target.checked)} />
                          </td>
                          <td className="px-2 py-1 font-mono text-xs">{row.label}</td>
                          <td className="px-2 py-1 text-gray-500"><D value={row.date} /></td>
                          <td className="px-2 py-1 text-right">{fmt(row.outstanding)}</td>
                          <td className="px-2 py-1">
                            <AmountInput bare
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!checked}
                              value={allocated[row.id] ?? ""}
                              onChange={(e) => {
                                const next = { ...allocated, [row.id]: e.target.value };
                                setAllocated(next);
                                if (amountAuto.current) setAmount(fmt(Object.values(next).reduce((s, v) => s + (parseFloat(v) || 0), 0)));
                              }}
                              className="rounded-md border border-line-strong bg-surface px-2.5 py-[5px] text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-surface-2 disabled:text-ink-3 w-24 text-right"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
                <span className="text-gray-500">Unallocated </span>
                <span className="font-medium text-gray-900">{fmt(unallocated)}</span>
              </div>
            </div>
          </section>
        )}

        <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex items-center justify-end gap-3 border-t border-line bg-surface px-5 py-3">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded text-gray-500 hover:text-gray-700 text-sm px-2 py-1.5 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => performSave(false)}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-[5px] text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? (editing ? "Saving..." : "Posting...") : editing ? "Save changes" : "Post Payment"}
          </button>
        </div>
      </div>

      {dialog}

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
