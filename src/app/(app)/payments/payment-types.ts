export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  customer_payment: "Customer Payment",
  customer_advance: "Customer Advance",
  loan_received: "Loan Received",
  capital_introduced: "Capital Introduced",
  refund_received: "Refund Received",
  other_receipt: "Other Receipt",
  supplier_payment: "Supplier Payment",
  customer_refund: "Customer Refund",
  salary_payment: "Salary Payment",
  staff_advance: "Staff Advance",
  expense_payment: "Expense Payment",
  tax_payment: "Tax Payment",
  loan_repayment: "Loan Repayment",
  supplier_advance: "Supplier Advance",
  owner_withdrawal: "Owner Withdrawal",
  cash_withdrawal: "Cash Withdrawal",
  bank_transfer: "Bank Transfer",
  other_payment: "Other Payment",
};

export const MONEY_IN_TYPE_OPTIONS = [
  { value: "customer_payment", label: "Customer Payment" },
  { value: "customer_advance", label: "Customer Advance" },
  { value: "loan_received", label: "Loan Received" },
  { value: "capital_introduced", label: "Capital Introduced" },
  { value: "refund_received", label: "Refund Received" },
  { value: "other_receipt", label: "Other Receipt" },
] as const;

export const MONEY_OUT_TYPE_OPTIONS = [
  { value: "supplier_payment", label: "Supplier Payment" },
  { value: "customer_refund", label: "Customer Refund" },
  { value: "salary_payment", label: "Salary Payment" },
  { value: "staff_advance", label: "Staff Advance" },
  { value: "expense_payment", label: "Expense Payment" },
  { value: "tax_payment", label: "Tax Payment" },
  { value: "loan_repayment", label: "Loan Repayment" },
  { value: "supplier_advance", label: "Supplier Advance" },
  { value: "owner_withdrawal", label: "Owner Withdrawal" },
  { value: "cash_withdrawal", label: "Cash Withdrawal" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "other_payment", label: "Other Payment" },
] as const;

export const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "online", label: "Online Payment" },
  { value: "other", label: "Other" },
] as const;

export const ALLOCATABLE_TYPES = ["customer_payment", "supplier_payment", "expense_payment"];
export const TRANSFER_TYPES = ["bank_transfer", "cash_withdrawal"];

export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "partially_allocated", label: "Partially Allocated" },
  { value: "fully_allocated", label: "Fully Allocated" },
  { value: "unallocated", label: "Unallocated" },
  { value: "reconciled", label: "Reconciled" },
  { value: "voided", label: "Voided" },
] as const;
