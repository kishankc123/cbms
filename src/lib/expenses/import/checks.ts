import { netFromInclusive } from "@/lib/sales/import/amounts";
import type { PurchaseBillTypeValue } from "@/lib/purchases/import/values";
import type { CategoryState, SupplierState } from "@/lib/purchases/import/checks";

// Whether an imported expense row can become an expense as it stands, and what is wrong when it can't. Pure: no database. The
// review and the import both run this, so what you approved is what gets posted.

export type ExpenseRowStatus = "ready" | "attention" | "duplicate" | "skipped";
export type ExpenseRowIssue = "date" | "locked" | "amount" | "billType" | "vat" | "tds" | "paid" | "account" | "supplier" | "category" | "dueDate" | "rule";

export type ExpenseRowInput = {
  dateIso: string | null;
  dateNote?: string;
  periodLocked: boolean;
  dueDate: { text: string; iso: string | null };
  amount: { value: number | null; invalid: boolean };
  billType: PurchaseBillTypeValue | undefined | null;
  billTypeText?: string;
  vat: { value: number | null; invalid: boolean };
  tds: { value: number | null; invalid: boolean };
  paid: { value: number | null; invalid: boolean };
  account: "none" | "ok" | "unknown";
  accountText?: string;
  supplier: SupplierState;
  category: CategoryState;
  categoryText?: string;
  duplicate: boolean;
  settings: {
    amountsIncludeVat: boolean;
    vatRate: number;
    defaultBillType: PurchaseBillTypeValue;
    paidMode: "file" | "unpaid" | "full";
    hasDefaultAccount: boolean;
    /** The organization's own amount rules: a message when an expense of this total is blocked. */
    blockedBy: (total: number) => string | null;
  };
};

export type ExpenseRowCheck = {
  status: ExpenseRowStatus;
  issues: ExpenseRowIssue[];
  messages: string[];
  computed: { taxable: number; vat: number; tds: number; total: number; payable: number; paid: number; billType: PurchaseBillTypeValue } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkExpenseRow(i: ExpenseRowInput): ExpenseRowCheck {
  if (i.supplier === "skipped" || i.category === "skipped") return { status: "skipped", issues: [], messages: ["Skipped"], computed: null };

  const issues: ExpenseRowIssue[] = [];
  const messages: string[] = [];
  const flag = (issue: ExpenseRowIssue, message: string) => {
    if (!issues.includes(issue)) issues.push(issue);
    messages.push(message);
  };

  if (!i.dateIso) flag("date", i.dateNote ?? "The date can't be read.");
  else if (i.periodLocked) flag("locked", "This date is in a closed period.");
  if (i.dueDate.text && !i.dueDate.iso) flag("dueDate", "The due date can't be read.");
  else if (i.dueDate.iso && i.dateIso && i.dueDate.iso < i.dateIso) flag("dueDate", "The due date is before the expense date.");

  if (i.amount.invalid) flag("amount", "The amount isn't a number.");
  else if (i.amount.value === null) flag("amount", "There is no amount.");
  else if (i.amount.value <= 0) flag("amount", i.amount.value < 0 ? "A negative amount isn't imported as an expense." : "The amount must be more than zero.");

  if (i.billType === null) flag("billType", `"${i.billTypeText ?? ""}" isn't a bill type. Use VAT, PAN, estimate, challan or no bill.`);
  const billType: PurchaseBillTypeValue = i.billType ?? i.settings.defaultBillType;

  if (i.category === "none") flag("category", "Choose the expense category (a column in the file, or the default below).");
  else if (i.category === "unknown") flag("category", `"${i.categoryText ?? ""}" isn't one of your expense categories.`);

  if (i.vat.invalid) flag("vat", "The VAT amount isn't a number.");
  else if ((i.vat.value ?? 0) < 0) flag("vat", "The VAT can't be negative.");
  else if ((i.vat.value ?? 0) > 0 && billType !== "vat") flag("vat", "VAT can only be recorded when the bill type is VAT.");
  if (i.tds.invalid) flag("tds", "The TDS amount isn't a number.");
  else if ((i.tds.value ?? 0) < 0) flag("tds", "The TDS can't be negative.");

  let computed: ExpenseRowCheck["computed"] = null;
  const amountOk = !i.amount.invalid && i.amount.value !== null && i.amount.value > 0;
  const taxesOk = !i.vat.invalid && (i.vat.value ?? 0) >= 0 && !i.tds.invalid && (i.tds.value ?? 0) >= 0 && !((i.vat.value ?? 0) > 0 && billType !== "vat");
  if (amountOk && taxesOk) {
    const a = i.amount.value!;
    const rate = billType === "vat" ? i.settings.vatRate : 0;
    let taxable: number;
    let vat: number;
    if (i.vat.value !== null && i.vat.value > 0) {
      vat = round2(i.vat.value);
      taxable = i.settings.amountsIncludeVat ? round2(a - vat) : a;
    } else if (rate > 0 && i.settings.amountsIncludeVat) {
      taxable = netFromInclusive(a, rate);
      vat = round2(taxable * (rate / 100));
    } else {
      taxable = a;
      vat = rate > 0 ? round2(a * (rate / 100)) : 0;
    }
    if (taxable <= 0) flag("amount", "The VAT is as much as the amount.");
    const tds = round2(i.tds.value ?? 0);
    const total = round2(taxable + vat);
    const payable = round2(total - tds);
    if (payable < 0) flag("tds", "The TDS can't be more than the total.");

    let paid = 0;
    if (payable >= 0) {
    if (i.settings.paidMode === "full") paid = Math.max(payable, 0);
    else if (i.settings.paidMode === "file") {
      if (i.paid.invalid) flag("paid", "The paid amount isn't a number.");
      else paid = round2(Math.max(i.paid.value ?? 0, 0));
    }
    if (paid > payable + 0.004) flag("paid", `The paid amount (${paid.toFixed(2)}) is more than the amount payable (${payable.toFixed(2)}).`);
    if (paid > 0) {
      if (i.account === "unknown") flag("account", `"${i.accountText ?? ""}" isn't one of your cash or bank accounts.`);
      else if (i.account === "none" && !i.settings.hasDefaultAccount) flag("account", "Choose the account the money was paid from.");
    }
    // Only a fully paid expense can go without a supplier: otherwise the unpaid part has nobody to be owed to.
    if (paid < payable - 0.004 && (i.supplier === "none" || i.supplier === "unknown")) {
      flag("supplier", i.supplier === "unknown" ? "This supplier isn't set up yet." : "A supplier is needed, because the expense isn't fully paid.");
    }
    }
    const blocked = i.settings.blockedBy(total);
    if (blocked) flag("rule", blocked);
    computed = { taxable, vat, tds, total, payable, paid, billType };
  }
  if (i.supplier === "unknown" && !issues.includes("supplier")) flag("supplier", "This supplier isn't set up yet.");

  if (issues.length > 0) return { status: "attention", issues, messages, computed };
  if (i.duplicate) return { status: "duplicate", issues, messages: ["An expense with the same supplier and invoice number, or the same date, supplier and amount, already exists."], computed };
  return { status: "ready", issues, messages, computed };
}
