import { netFromInclusive, rowTotals } from "@/lib/sales/import/amounts";
import type { PurchaseBillTypeValue } from "./values";

// Whether an imported purchase row can become a bill as it stands, and what is wrong when it can't. Pure: no database. The
// review and the import both run this, so what you approved is what gets posted.

export type PurchaseRowStatus = "ready" | "attention" | "duplicate" | "skipped";
export type PurchaseRowIssue = "date" | "locked" | "amount" | "discount" | "billType" | "paid" | "account" | "supplier" | "category";
export type SupplierState = "none" | "matched" | "create" | "unknown" | "skipped";
export type CategoryState = "ok" | "none" | "unknown" | "skipped";

export type PurchaseRowInput = {
  dateIso: string | null;
  dateNote?: string;
  periodLocked: boolean;
  amount: { value: number | null; invalid: boolean };
  discount: { value: number | null; invalid: boolean };
  billType: PurchaseBillTypeValue | undefined | null;
  billTypeText?: string;
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
  };
};

export type PurchaseRowCheck = {
  status: PurchaseRowStatus;
  issues: PurchaseRowIssue[];
  messages: string[];
  computed: { gross: number; discount: number; subtotal: number; tax: number; total: number; paid: number; billType: PurchaseBillTypeValue } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function checkPurchaseRow(i: PurchaseRowInput): PurchaseRowCheck {
  if (i.supplier === "skipped" || i.category === "skipped") return { status: "skipped", issues: [], messages: ["Skipped"], computed: null };

  const issues: PurchaseRowIssue[] = [];
  const messages: string[] = [];
  const flag = (issue: PurchaseRowIssue, message: string) => {
    if (!issues.includes(issue)) issues.push(issue);
    messages.push(message);
  };

  if (!i.dateIso) flag("date", i.dateNote ?? "The date can't be read.");
  else if (i.periodLocked) flag("locked", "This date is in a closed period.");

  if (i.amount.invalid) flag("amount", "The amount isn't a number.");
  else if (i.amount.value === null) flag("amount", "There is no amount.");
  else if (i.amount.value <= 0) flag("amount", i.amount.value < 0 ? "A negative amount is a purchase return, which isn't imported here." : "The amount must be more than zero.");

  const discountValue = i.discount.value ?? 0;
  if (i.discount.invalid) flag("discount", "The discount isn't a number.");
  else if (discountValue < 0) flag("discount", "The discount can't be negative.");
  else if (i.amount.value !== null && discountValue > i.amount.value) flag("discount", "The discount is more than the amount.");

  if (i.billType === null) flag("billType", `"${i.billTypeText ?? ""}" isn't a bill type. Use VAT, PAN, estimate, challan or no bill.`);
  const billType: PurchaseBillTypeValue = i.billType ?? i.settings.defaultBillType;

  if (i.category === "none") flag("category", "Choose the purchase category (a column in the file, or the default below).");
  else if (i.category === "unknown") flag("category", `"${i.categoryText ?? ""}" isn't one of your purchase categories.`);

  let computed: PurchaseRowCheck["computed"] = null;
  const amountOk = !i.amount.invalid && i.amount.value !== null && i.amount.value > 0 && !i.discount.invalid && discountValue >= 0 && discountValue <= i.amount.value;
  if (amountOk) {
    // VAT applies only to a VAT bill; for any other bill type the amount is the whole cost.
    const vatRate = billType === "vat" ? i.settings.vatRate : 0;
    let t;
    if (i.settings.amountsIncludeVat && billType === "vat") {
      const net = netFromInclusive(round2(i.amount.value! - discountValue), vatRate);
      t = rowTotals(net, 0, "taxable", vatRate);
    } else {
      t = rowTotals(i.amount.value!, discountValue, billType === "vat" ? "taxable" : "zero_rated", vatRate);
    }
    let paid = 0;
    if (i.settings.paidMode === "full") paid = t.total;
    else if (i.settings.paidMode === "file") {
      if (i.paid.invalid) flag("paid", "The paid amount isn't a number.");
      else paid = round2(Math.max(i.paid.value ?? 0, 0));
    }
    if (paid > t.total + 0.004) flag("paid", `The paid amount (${paid.toFixed(2)}) is more than the bill total (${t.total.toFixed(2)}).`);
    if (paid > 0) {
      if (i.account === "unknown") flag("account", `"${i.accountText ?? ""}" isn't one of your cash or bank accounts.`);
      else if (i.account === "none" && !i.settings.hasDefaultAccount) flag("account", "Choose the account the money was paid from.");
    }
    // Only a fully paid bill can go without a supplier: otherwise the unpaid part has nobody to be owed to.
    if (paid < t.total - 0.004 && (i.supplier === "none" || i.supplier === "unknown")) {
      flag("supplier", i.supplier === "unknown" ? "This supplier isn't set up yet." : "A supplier is needed, because the bill isn't fully paid.");
    }
    computed = { gross: t.gross, discount: t.discount, subtotal: t.subtotal, tax: t.tax, total: t.total, paid, billType };
  }
  if (i.supplier === "unknown" && !issues.includes("supplier")) flag("supplier", "This supplier isn't set up yet.");

  if (issues.length > 0) return { status: "attention", issues, messages, computed };
  if (i.duplicate) return { status: "duplicate", issues, messages: ["A bill with the same supplier and number, or the same date, supplier and amount, already exists."], computed };
  return { status: "ready", issues, messages, computed };
}
