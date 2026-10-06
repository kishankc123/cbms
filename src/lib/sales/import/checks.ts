import { netFromInclusive, rowTotals } from "./amounts";
import type { SalesBillTypeValue } from "./values";

// Whether an imported row can become an invoice as it stands, and what is wrong when it can't. Pure: no database. The
// review screen and the import itself both run this, so what you approved is what gets posted.

export type RowStatus = "ready" | "attention" | "duplicate" | "skipped";
export type RowIssue = "date" | "locked" | "amount" | "discount" | "billType" | "revenue" | "paid" | "account" | "customer";

export type CustomerState = "none" | "matched" | "create" | "unknown" | "skipped";

export type RowCheckInput = {
  dateIso: string | null;
  dateNote?: string;
  periodLocked: boolean;
  amount: { value: number | null; invalid: boolean };
  discount: { value: number | null; invalid: boolean };
  /** undefined = cell blank, null = not a bill type */
  billType: SalesBillTypeValue | undefined | null;
  billTypeText?: string;
  paid: { value: number | null; invalid: boolean };
  /** The account named in the file: none given, found, or named but not a cash/bank account. */
  account: "none" | "ok" | "unknown";
  accountText?: string;
  /** The revenue account named in the file: none given, found, or named but not one that can be chosen. */
  revenue?: "none" | "ok" | "unknown";
  revenueText?: string;
  customer: CustomerState;
  duplicate: boolean;
  settings: {
    amountsIncludeVat: boolean;
    vatRate: number;
    defaultBillType: SalesBillTypeValue;
    /** What to assume about payment when the file says nothing: unpaid, or paid in full. "file" = use the paid column only. */
    paidMode: "file" | "unpaid" | "full";
    hasDefaultAccount: boolean;
  };
};

export type RowCheck = {
  status: RowStatus;
  issues: RowIssue[];
  messages: string[];
  /** Present once the amounts could be worked out. */
  computed: { gross: number; discount: number; subtotal: number; tax: number; total: number; paid: number; billType: SalesBillTypeValue } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkRow(i: RowCheckInput): RowCheck {
  if (i.customer === "skipped") return { status: "skipped", issues: [], messages: ["Skipped"], computed: null };

  const issues: RowIssue[] = [];
  const messages: string[] = [];
  const flag = (issue: RowIssue, message: string) => {
    if (!issues.includes(issue)) issues.push(issue);
    messages.push(message);
  };

  if (!i.dateIso) flag("date", i.dateNote ?? "The date can't be read.");
  else if (i.periodLocked) flag("locked", "This date is in a closed period.");

  if (i.amount.invalid) flag("amount", "The amount isn't a number.");
  else if (i.amount.value === null) flag("amount", "There is no amount.");
  else if (i.amount.value <= 0) flag("amount", i.amount.value < 0 ? "A negative amount is a sales return, which isn't imported here." : "The amount must be more than zero.");

  const discountValue = i.discount.value ?? 0;
  if (i.discount.invalid) flag("discount", "The discount isn't a number.");
  else if (discountValue < 0) flag("discount", "The discount can't be negative.");
  else if (i.amount.value !== null && discountValue > i.amount.value) flag("discount", "The discount is more than the amount.");

  if (i.billType === null) flag("billType", `"${i.billTypeText ?? ""}" isn't a bill type. Use taxable or zero-rated.`);
  const billType: SalesBillTypeValue = i.billType ?? i.settings.defaultBillType;
  if (i.revenue === "unknown") flag("revenue", `"${i.revenueText ?? ""}" isn't a revenue account you can post to (a group that has sub-groups can't be chosen; pick one of its sub-groups).`);

  let computed: RowCheck["computed"] = null;
  const amountOk = !i.amount.invalid && i.amount.value !== null && i.amount.value > 0 && !i.discount.invalid && discountValue >= 0 && discountValue <= i.amount.value;
  if (amountOk) {
    const vatRate = i.settings.vatRate;
    let t;
    if (i.settings.amountsIncludeVat) {
      // The file's amount is what the customer pays, after discount: work back to the amount before VAT.
      const net = netFromInclusive(round2(i.amount.value! - discountValue), billType === "taxable" ? vatRate : 0);
      t = rowTotals(net, 0, billType, vatRate);
    } else {
      t = rowTotals(i.amount.value!, discountValue, billType, vatRate);
    }
    let paid = 0;
    if (i.settings.paidMode === "full") paid = t.total;
    else if (i.settings.paidMode === "file") {
      if (i.paid.invalid) flag("paid", "The paid amount isn't a number.");
      else paid = round2(Math.max(i.paid.value ?? 0, 0));
    }
    if (paid > t.total + 0.004) {
      flag("paid", `The paid amount (${paid.toFixed(2)}) is more than the invoice total (${t.total.toFixed(2)}).`);
    }
    if (paid > 0) {
      if (i.account === "unknown") flag("account", `"${i.accountText ?? ""}" isn't one of your cash or bank accounts.`);
      else if (i.account === "none" && !i.settings.hasDefaultAccount) flag("account", "Choose the account the money was received into.");
    }
    // Only a fully paid invoice can go without a customer: otherwise the unpaid part has nobody to be owed by.
    if (paid < t.total - 0.004 && (i.customer === "none" || i.customer === "unknown")) {
      flag("customer", i.customer === "unknown" ? "This customer isn't set up yet." : "A customer is needed, because the invoice isn't fully paid.");
    }
    computed = { ...t, paid, billType };
  }
  if (i.customer === "unknown" && !issues.includes("customer")) flag("customer", "This customer isn't set up yet.");

  if (issues.length > 0) return { status: "attention", issues, messages, computed };
  if (i.duplicate) return { status: "duplicate", issues, messages: ["An invoice with the same date, customer and amount already exists."], computed };
  return { status: "ready", issues, messages, computed };
}
