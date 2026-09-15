# Functional Specification: Multi-Tenant Client Accounting Platform

**Purpose of this document:** This is the complete functional and data specification for a web application that lets an accounting practice manage bookkeeping, ledgers, and financial reports for multiple independent clients. This document is written to be handed directly to an AI coding assistant (e.g. Claude Code) as the source of truth for building the system. It defines *what* to build and the accounting logic that must be respected; the assistant/developer has latitude on specific tech stack and implementation details unless stated otherwise.

---

## 1. System Overview

A multi-tenant SaaS-style web application where:
- **Super Admin** = the accounting practice (single entity, owns the whole platform)
- **Admin** = one accounting "tenant" per client business (each client is a fully isolated set of books)
- **User** = staff/team members under a given client's Admin (optional, for clients who want their own staff entering data)

Each client's data (transactions, ledgers, reports) must be **completely isolated** from every other client's data. A user or admin from Client A must never be able to view, query, or infer any data belonging to Client B, even via direct URL manipulation, API calls, or export functions.

### 1.1 Core design principle: double-entry accounting engine

The system must be built on a **double-entry bookkeeping engine**, not a collection of independent transaction lists. Concretely:

- Every financial event (a sale, purchase, expense, payment, receipt, bank reconciliation adjustment) must generate one or more **Journal Entries**, each composed of **Journal Lines** where total debits = total credits.
- Front-end screens (Sales, Purchases, Expenses, etc.) are *convenience interfaces* over this engine — the user never has to think about debits/credits directly, but the system posts the correct entries behind the scenes.
- All reports (Ledger, Trial Balance, Profit & Loss, Balance Sheet) are **derived views** computed from the Journal Entries table — they are never separately maintained or manually reconciled against the transaction screens. This guarantees the reports always tie out.
- **Journal entries are never hard-deleted.** Corrections are made via reversing/adjusting entries, preserving a full audit trail. This is standard accounting practice and a compliance requirement in most jurisdictions.
- The system operates on **accrual basis** accounting by default (transactions recorded when incurred, not when cash moves), which is the standard basis for producing a P&L and Balance Sheet. Cash-basis reporting can be offered as a report filter/toggle if needed later, but the underlying ledger stays accrual-based.

---

## 2. Roles & Permissions

| Role | Scope | Key capabilities |
|---|---|---|
| Super Admin | Entire platform, all clients | Create/suspend/delete client (Admin) accounts; view platform-wide usage/billing; cannot casually browse client financial data (see note below); manage global settings (e.g. default chart of accounts templates) |
| Admin | One client's full books | Full CRUD on that client's transactions, chart of accounts, users; can invite/manage that client's Users; can view all reports; can lock/close accounting periods |
| User | One client's books, restricted | Can be scoped to specific modules (e.g. only Sales entry, no access to Reports or Expenses) via a permissions matrix; cannot manage other users; cannot delete posted/locked transactions |

**Note on Super Admin access to client data:** Even though Super Admin technically "owns" the platform, access to a specific client's financial data should require an explicit, logged action (e.g. "impersonate/support mode") rather than silent default visibility — this protects client confidentiality and should itself be an audit-logged event.

### 2.1 Permission granularity (future-proofing)
Design the permission system as a **matrix of (module × action)** rather than hardcoded roles, e.g.:

```
permissions: {
  sales: { view: true, create: true, edit: true, delete: false },
  purchases: { view: true, create: false, edit: false, delete: false },
  reports: { view: true, create: false, edit: false, delete: false },
  ...
}
```

This lets you add new modules or finer-grained roles later (e.g. "read-only auditor" role) without restructuring the permission system.

---

## 3. Core Data Model

This is the backbone. Build these tables/entities first, before any UI.

### 3.1 Tenancy & Identity
- **Tenants (Clients)**: id, company name, industry, fiscal year start month, base currency, VAT/tax registration number, status (active/suspended), created_at
- **Users**: id, tenant_id (nullable for Super Admin), name, email, password_hash, role, permissions (JSON, see 2.1), status, last_login, created_at
- **Audit Log**: id, tenant_id, user_id, action, entity_type, entity_id, before_value, after_value, timestamp — every create/edit/delete/impersonation event across the system

### 3.2 Chart of Accounts (per tenant)
Every tenant gets a chart of accounts following the standard five-category structure:

| Category | Normal Balance | Examples |
|---|---|---|
| Assets | Debit | Cash, Bank, Accounts Receivable, Inventory, Fixed Assets |
| Liabilities | Credit | Accounts Payable, Loans, Tax Payable |
| Equity | Credit | Owner's Capital, Retained Earnings |
| Income | Credit | Sales Revenue, Other Income |
| Expenses | Debit | Cost of Goods Sold, Rent, Salaries, Utilities |

- **Accounts**: id, tenant_id, code, name, category (asset/liability/equity/income/expense), sub_category, parent_account_id (for hierarchy, e.g. "Bank" > "Bank - Nabil A/C"), is_active
- Ship a default chart-of-accounts template per industry/region that Admin can customize per client — this saves enormous onboarding time versus building from scratch per client.

### 3.3 The Ledger Core
- **Journal Entries**: id, tenant_id, entry_date, reference_number, source_type (sale/purchase/expense/payment/receipt/bank_adjustment/manual), source_id, memo, created_by, created_at, is_reversed, reversal_of_id
- **Journal Lines**: id, journal_entry_id, account_id, debit_amount, credit_amount, description
  - Constraint: for a given journal_entry_id, SUM(debit_amount) must equal SUM(credit_amount)

### 3.4 Transactional Modules (each generates Journal Entries automatically)

**Sales / Income**
- Sales Invoices: id, tenant_id, customer_id, invoice_number, invoice_date, due_date, line_items (JSON or child table: description, quantity, unit_price, tax_rate), subtotal, tax_amount, total, status (draft/sent/paid/partially_paid/overdue), amount_paid
- Customers: id, tenant_id, name, contact_info, opening_balance
- Auto-posts: Debit Accounts Receivable (or Bank/Cash if immediate), Credit Sales Revenue, Credit Tax Payable (if applicable)

**Purchases**
- Purchase Bills: id, tenant_id, vendor_id, bill_number, bill_date, due_date, line_items, subtotal, tax_amount, total, status, amount_paid
- Vendors: id, tenant_id, name, contact_info, opening_balance
- Auto-posts: Debit Purchases/Inventory/relevant expense account, Debit Tax Receivable (if applicable), Credit Accounts Payable (or Bank/Cash if immediate)

**Expenses**
- Expenses: id, tenant_id, expense_date, category (maps to a chart-of-accounts expense account), vendor (optional), amount, tax_amount, payment_method, attachment (receipt image/file), notes
- Auto-posts: Debit relevant Expense account, Credit Bank/Cash/Accounts Payable

**Payments & Receipts**
- Payments (money out): id, tenant_id, payment_date, paid_to (vendor/other), amount, bank_account_id, applied_to_bill_ids (for settling purchase bills)
- Receipts (money in): id, tenant_id, receipt_date, received_from (customer/other), amount, bank_account_id, applied_to_invoice_ids (for settling sales invoices)
- Auto-posts: standard cash/bank clearing entries against AR/AP

**Bank Reconciliation**
- Bank Accounts: id, tenant_id, account_name, account_number (masked), currency, chart_of_accounts_link
- Bank Statement Imports: id, tenant_id, bank_account_id, imported_file_reference, import_date, statement_period_start, statement_period_end
- Bank Statement Lines: id, import_id, transaction_date, description, amount, matched_journal_line_id (nullable), match_status (unmatched/auto_matched/manually_matched/ignored)
- Reconciliation logic: match statement lines to journal lines posted against that bank account by amount + date proximity + optional reference text; surface unmatched items on both sides for manual review; once a period is reconciled, lock it from silent edits (any change requires a reversing entry).

---

## 4. Module Specifications

### 4.1 Dashboard
- Per-tenant, role-aware (Admin sees full financial KPIs; restricted Users see only what their permissions allow)
- KPIs: Total Revenue (period), Total Expenses (period), Net Profit/Loss, Cash & Bank Balance, Accounts Receivable outstanding (with aging buckets: 0-30/31-60/61-90/90+ days), Accounts Payable outstanding (same aging), Top expense categories, Sales trend chart (monthly)
- Date range selector (this month, last month, this quarter, this fiscal year, custom range)
- All figures computed live from Journal Entries — no separately cached "dashboard numbers" that can drift out of sync

### 4.2 Sales / Income
- Create/edit/void sales invoices with line items, tax calculation, and status tracking
- Record direct income not tied to an invoice (e.g. misc income)
- Customer list with running balance per customer
- Partial payment support against invoices

### 4.3 Purchases
- Create/edit/void purchase bills with line items and tax
- Vendor list with running balance per vendor
- Partial payment support against bills

### 4.4 Expenses
- Quick-entry expense form categorized against the chart of accounts
- Receipt/document attachment per expense
- Recurring expense templates (e.g. monthly rent) that auto-generate on schedule

### 4.5 Bank Reconciliation
- Upload bank statements (CSV at minimum; PDF parsing as a stretch goal)
- Auto-match against posted journal lines; manual match/unmatch UI for exceptions
- Reconciliation summary report per bank account per period (opening balance, statement total, book total, reconciling items, closing balance)

### 4.6 Reports
All reports must be generated **live from the Journal Entries/Lines tables**, filterable by date range, and exportable (PDF/Excel).

- **General Ledger**: transaction-level detail per account, running balance
- **Trial Balance**: all accounts with debit/credit totals as of a date — must always balance to zero difference (this is a good built-in system health check)
- **Profit & Loss (Income Statement)**: Income accounts minus Expense accounts for a period, standard format (Revenue → COGS → Gross Profit → Operating Expenses → Net Profit)
- **Balance Sheet**: Assets = Liabilities + Equity as of a date, standard format with current/non-current asset and liability groupings
- **Accounts Receivable / Accounts Payable Aging Reports**
- Optional later: Cash Flow Statement, budget-vs-actual

---

## 5. Non-Functional Requirements

- **Data isolation**: every query must be scoped by tenant_id at the data-access layer, not just filtered in the UI — this should be enforced structurally (e.g. row-level security or a mandatory tenant-scoped query wrapper) so a coding mistake in one screen can't leak another tenant's data.
- **Audit trail**: every create/edit/delete on financial data is logged (see Audit Log table) with before/after values and the acting user.
- **No silent deletion of posted transactions**: once a transaction is posted (has generated journal entries), it should be voided/reversed rather than deleted, preserving history.
- **Period locking**: once a client's period (e.g. a month) is closed/reconciled, further edits to that period require explicit unlock + are logged.
- **Backups**: automated regular backups with a tested restore process.
- **Authentication security**: password hashing (never plain text), support for two-factor authentication, session expiry.
- **Scalability of chart of accounts**: must support account hierarchies (parent/child) and per-tenant customization without schema changes.
- **Currency**: store amounts with explicit currency per tenant at minimum; design the schema so multi-currency (per-transaction currency + exchange rate) can be added later without restructuring.
- **Localization note**: this practice serves clients that may be subject to Nepali tax requirements (e.g. VAT). Tax fields (tax_rate, tax_amount, tax account mapping) should be present from day one even if only simple flat-rate VAT is implemented initially, so tax reporting can be extended later without reworking the transaction schema.

---

## 6. Suggested Build Sequence (MVP → Full)

1. Tenancy, auth, roles/permissions scaffold
2. Chart of Accounts + Journal Entries/Lines engine (with a way to manually post entries, for testing)
3. Sales module (invoices, customers) wired to auto-post journal entries
4. Purchases module (bills, vendors) wired to auto-post
5. Expenses module wired to auto-post
6. Payments & Receipts (settling invoices/bills)
7. Reports: Trial Balance, Ledger, P&L, Balance Sheet (validate these tie out correctly using test data before moving on)
8. Dashboard KPIs
9. Bank accounts + statement import + reconciliation matching
10. Aging reports, recurring transactions, attachments/OCR, audit log UI, period locking
11. Advanced/future features (see Section 7)

**Testing checkpoint**: after step 7, deliberately enter a small, fully worked example set of transactions (a handful of sales, purchases, expenses) and manually verify the Trial Balance, P&L and Balance Sheet by hand against what the system produces. Do not proceed to build further modules until these three reports are verifiably correct — they are the foundation everything else depends on.

---

## 7. Future / Advanced Feature Backlog (post-MVP)

- OCR-based receipt/invoice capture (photo → drafted expense/bill entry)
- Recurring invoices and recurring bills
- Multi-currency transactions with exchange rate handling and unrealized gain/loss postings
- Client-facing read-only portal (clients view their own balances/reports without editing)
- Document vault per client (contracts, statements) linked to relevant transactions
- Budget vs. actual reporting
- Cash Flow Statement
- VAT/TDS-specific return-ready reports for local compliance
- Bulk import tool for migrating historical data from the existing Google Sheets/Excel workbooks
- API access / integrations (e.g. export to VT++ format if still needed during transition)
- White-label/reseller mode if this is ever offered to other accounting practices

---

## 8. Notes for the Developer / AI Coding Assistant

- Prioritize correctness of the double-entry engine and report generation over UI polish in the early build — a beautiful dashboard on top of a broken ledger is worse than a plain one on top of a correct ledger.
- Any new transaction type added in the future (e.g. a new module) should follow the same pattern: capture the business-facing form, then generate the appropriate Journal Entry/Lines — never bypass the ledger.
- Favor an architecture where reports are computed on-demand from Journal Entries rather than cached/duplicated, unless performance profiling later shows a genuine need for caching — correctness must not be sacrificed for premature optimization.
- Ask the practice owner (the domain expert) to manually verify Trial Balance/P&L/Balance Sheet outputs against a hand-worked example before considering the reporting module complete.
