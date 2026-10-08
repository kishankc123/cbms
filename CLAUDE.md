@AGENTS.md

# Development Context (for continuing in a new session)

Last updated: 2026-10-08, as of commit `13cbba8` on `main` (working tree clean at that point — still run
`git status` first thing in a new session). Migrations in the repo run through `0087`; **Vercel's database
only has what was run on it by hand — deploys do not run migrations** (see "Operations" below).

## What this app is

A multi-tenant accounting SaaS for Nepal (Next.js 16 App Router, Drizzle ORM, Neon Postgres, NextAuth v5,
Tailwind). Dual AD/BS (Bikram Sambat) calendar support throughout — dates are always stored as AD
`YYYY-MM-DD`; BS is derived for display/entry via `src/lib/calendar/` (the single calendar engine; never
duplicate date math elsewhere). Git user for this repo: kishankc123.

## Core architectural principles (already established, keep following them)

- **Users are global; organizations are tenants.** One `users` row per person (login is **email +
  password only**; `name` is the display name). They join organizations through `memberships`
  (many-to-many); "active organization" is session-scoped (`activeTenantId`). Every query is scoped by
  `tenantId`.
- **Journal entries are the ledger's single source of truth.** Every module posts through
  `postJournalEntry()` / `reverseJournalEntry()` in `src/lib/ledger/post.ts` — the one choke point. Never
  insert into `journal_entries`/`journal_lines` directly from a module.
- **One writer per kind of document, in `src/lib`, shared by every way of creating it.** Sales multi-invoice
  → `lib/sales/invoice-records.ts` (`postSalesBatch`); consumable purchases → `lib/purchases/cash-purchase.ts`
  (`createCashPurchaseCore`); supplier bills (incl. asset purchases) → `lib/purchases/bill-records.ts`. The
  forms, edit screens and the import screens all call these. Never add a second posting path.
- **Reports never recreate accounting logic.** They read from `journal_entries`/`journal_lines` via
  `src/lib/ledger/reports.ts` and sibling files — never a second computation that could disagree with the
  official numbers.
- **Permissions** (see `src/lib/permissions.ts` — the single catalog): modules × actions
  `view/create/edit/void/delete`, only actions that some check enforces are listed. `can(session, module,
  action)` in `src/lib/session.ts`. Roles are per-organization rows in `roles` (4 standard: Owner,
  Administrator = fixed full access/bypass; Accountant, Staff = editable; plus custom). `memberships.role` is
  the authority level (custom roles count as staff-level), `memberships.roleId` decides permissions.
  - "Void" means cancel/reverse a transaction; "Delete" means remove records (customers, accounts...).
  - **Every page must check View before reading data**: first line of a module page is
    `const denied = await guardView("<module>"); if (denied) return denied;` (`components/page-guard.tsx`).
    Layouts are NOT a security boundary (Next docs: they don't re-run on navigation).
  - **Every exported server action must call `can()`/`requireOrgAdmin`/`requirePlatformAdmin`**, and **no
    exported server action may take a `tenantId` from the caller** (anyone could pass another org's). Helpers
    that take a tenantId live in plain lib files, not in `"use server"` files.
  - `src/lib/permission-coverage.test.ts` fails when a page or action lacks a check. Keep it green; only add
    to its allowlists with a stated reason.
- **Audit logging**: `logAuditEvent()` in `src/lib/audit.ts`, append-only. Platform-admin actions log with
  `tenantId` null.
- **Close/reopen pattern** (accounting periods, bank reconciliations, fiscal years): closing is a routine
  action gated on `edit`; reopening is admin-only, requires a reason, always audit-logged.
- **Imports follow one shape** (Sales, Purchases, Expenses): Upload → Review → Done; columns and AD/BS dates detected
  automatically; unknown customers/suppliers grouped and decided once (tick to create, never auto-created);
  remembered matches and column mappings; typed row corrections ("overrides"); Check only; undo per import
  (batch id on the invoices/bills). The server re-reads and re-checks the file at every step and never trusts
  the browser's decisions. Pure rules are in `lib/*/import/{fields,values,checks,amounts,paste}.ts` (unit
  tested); DB work in `service.ts`. Purchases and Expenses post in slices (prepare → chunks → finish) with a
  progress bar because each document does many queries; Sales still posts in one request. Every import's
  upload screen shows a **column guide** (`lib/sales/import/column-guide.ts`, also written into each template's
  "Columns" sheet).
- **Payment modes** (Cash, Cheque, Bank transfer, Fonepay, Card, Wallet; `lib/payment-modes.ts`,
  `lib/payment-mode-rules.ts`): a mode links to **lowest-level** accounts of the chart (a group with
  sub-groups is never linked, its sub-groups are); one account can serve **many** modes. Every screen that
  moves money uses `components/payment-mode-select.tsx` (mode heading, accounts beneath) and passes `modeId`
  with each payment line; the mode is **saved** on the journal line (`journal_lines.payment_mode_id/name`) and
  on the payment record. The server validates the pair (`modeNamesForLines`, `resolvePaymentMode`) in the one
  posting choke point. `getCashBankAccounts()` includes mode-linked accounts, so balances, reports and guards
  see wallet accounts. Import cells accept an account or a mode with one account. Not yet on: recurring-expense
  "expected payment account", inter-transfers.
- **Revenue account on invoices**: `sales_invoices.revenue_account_id`; chosen on Single Invoice (overrides the
  items' accounts), each Multi-Invoice row, and the Sales import (column + default). Only lowest-level income
  accounts (`lib/sales/revenue-accounts.ts`); blank = Sales Revenue (4000) as before.
- **Compliance starts from a profile gate** (`lib/compliance/profile*.ts`): nothing is generated until entity
  type, PAN/VAT number and company registration date are set, plus VAT effective-from + filing basis when
  VAT-registered and the permit date when excise-registered. Start dates (`engine/start-dates.ts`): VAT from
  the VAT registration's single **Effective from** date, excise from the permit date, everything else from the
  company registration date. Registrations have ONE date ("Effective from"; the old registration date column
  was dropped). Recurring items cover every period since Shrawan 1 of the current fiscal year; the **catch-up
  checklist** (`lib/compliance/catchup*.ts`, `/compliance/catch-up`) asks "filed up to which year/month" per
  stream (income tax, VAT, TDS, excise permit), builds full history from the start dates and
  marks earlier periods `filed_before_system` (no fines, settled in the VAT worksheet). Unanswered streams
  show the current fiscal year only, on purpose (no flood of overdue items).
- **Excise permit** (`lib/compliance/excise-permit*.ts`, Tax Compliance → Excise): valid per fiscal year to the
  end of Ashadh; renewal window Shrawan 1–30; after that "penalty mode" with a fine that is a share of the
  company's own standard renewal fee by months late (bands are platform data). Renewal items appear in Tax
  Compliance; an alert banner shows on the compliance pages. The excisable-item flag and sales block were
  skipped on purpose.
- **Platform fines and penalties** (`/admin/compliance/penalties`, `lib/compliance/penalty-admin.ts`,
  `penalty-types.ts`): versions per fiscal year (start on Shrawan 1) for VAT, TDS and excise permit renewal;
  started versions are immutable, verification + source editable, audit-logged; organizations see the rates
  read-only on Fines & Penalties. The excise permit bands and the income-tax template (activated in migration
  0086) are **unverified** figures supplied by the business. **Excise returns are switched off** (migration
  0087; only for companies that manufacture or import excisable goods): the template stays in the config, inactive,
  and nothing about them shows in the app.
- Build **phase by phase**, verify live in the browser (built-in Browser pane) plus `npx tsc --noEmit`,
  `npx eslint`, `npx vitest run` and the integration tests, then **pause for the user's explicit go-ahead**
  before the next phase. **Only commit/push when explicitly asked.**
- Drizzle migrations: generate with
  `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs generate --name=<name>`, apply with
  `...migrate` (never the plain `npx drizzle-kit` shim). A data backfill can be hand-appended to a generated
  `.sql`. Integration tests: `node --env-file=.env.local node_modules/vitest/vitest.mjs run -c
  vitest.int.config.ts <path>` (they use throwaway `ZZ ...` organizations from `src/test/temp-org.ts`).

## What's built (all committed)

- **Reports** — all 29 reports across 7 phases, driven by `reports/report-catalog.ts`; the landing page lists
  only reports the person's role can open (each report page also checks its own module).
- **Fiscal Year & Accounting Period Engine, Phases 1-5** — `fiscal_years` table + service (`lib/fiscal.ts`),
  sidebar fiscal-year switcher, `journal_entries.fiscal_year_id` stamped at posting time, report defaults
  follow the active year, year-end closing readiness checklist (`lib/fiscal-closing.ts`). **Design decision
  (do not change casually):** no literal closing/zeroing journal entries — `balanceSheet()` computes retained
  earnings live from all P&L activity, so closing entries would corrupt cross-year P&L ranges.
- **Fixed Assets** (`src/lib/assets`, `src/app/(app)/assets`, sidebar group "Assets") — setup (categories,
  locations, default accounts), register + detail + schedule, purchase (creates a normal supplier bill of type
  `asset`), opening assets (post Dr cost / Cr accumulated depreciation / Cr Brought forward, editable until
  depreciation is posted), monthly book depreciation (one journal entry per run, per-asset lines in
  `asset_depreciation_lines`, catch-up for late assets, only the latest run reversible), sale / disposal /
  write-off (reversible; sales feed the sales register and VAT return; cash flow treats depreciation as a
  non-cash add-back and gain/loss as investing). Not built: transfers, bulk import, asset reports, audit
  checks, tax depreciation (country rules to be supplied), credit sales of assets, quantity per purchase.
- **Settings** is a sidebar group: Company details, General (calendar, invoice/payment numbering), Fiscal
  years (+ books start date), Users, Roles.
- **Roles & permissions** — `roles` table (migration 0073), matrix editor at Settings → Roles (list | add new,
  duplicate, reset standard role, delete when unused). `lib/role-store.ts` lazily creates the standard roles
  and links existing members.
- **User accounts & membership** — separate "Create a user account" and "Create a business account" on the
  login page; a signed-in person with no organization sees a landing screen. Settings → Users: list (member
  IDs `USR-0001`), Add new (exact email → if the account exists and its email is verified they are added
  **instantly**, with a notice banner + email and a Leave option; otherwise an invitation is offered), edit
  role/status, remove. `lib/org-members.ts`.
- **Platform administration** (`/admin`, platform-admin flag only): Overview counts, Users (list, detail,
  unlock, force sign-out, disable/enable, grant/revoke platform admin) and Organizations (list, detail,
  suspend with reason / reactivate). `lib/platform-admin.ts`. Still placeholders: Platform Audit Log, Billing,
  Compliance Configuration.
- **Import Sales / Purchases / Expenses** — tabs on Sales → Add new, Purchases → Consumable purchase and the
  Expenses page. One row per invoice/bill/expense (consumable purchases only; stockable purchases need item
  lines). Paste from Excel, template download, fix rows in place, Check only, "Fix and import the remaining
  rows", undo. Tables: `sales_imports`, `purchase_imports`, `expense_imports`, `customer_aliases`,
  `supplier_aliases`, `import_column_mappings`. Server-action body limit raised to 4 MB in `next.config.ts`.
  Expenses post through `lib/expenses/expense-records.ts` (`createExpenseCore`).
- **Settings → Payment modes** (list, add, edit, delete; owner/admin only). Customers and suppliers: PAN / VAT
  number is **optional** (still 9 digits when typed); the company's own PAN stays mandatory.
- **Dashboard** (`/dashboard`) has a greeting by Nepal time ("Good morning, <name>"), KPIs, a
  revenue/expense chart and cash/bank balances; the original full spec was never re-checked against it.

## Operations / things only the user can do

- Run migrations **0065–0087** (and any later ones) on the Vercel database by hand, and make sure its host
  matches `.env.local` (compare the host of the production `DATABASE_URL` with the local one; if they are the
  same database nothing needs running). Commands for a manual run: set `$env:DATABASE_URL` in PowerShell to the
  production URL, check the host, back up in Neon, then `node ./node_modules/drizzle-kit/bin.cjs migrate`.
  Without them Roles, Users, Imports, Payment modes, revenue accounts and the compliance screens error there.
- `lib/rate-limit.ts` is in-memory per server instance — ineffective on Vercel's serverless; needs a shared
  store. Email needs a real provider in production (dev prints invitation links).
- Import Sales posts in a single request; a very large file could exceed Vercel's time limit (Purchases
  already posts in slices).

## What's explicitly NOT built / open decisions

- Default **Staff** still sees the Dashboard KPIs and financial statements because Chart of Accounts view is on
  for Staff — a role-configuration decision for the user (turn it off, or add a dashboard permission).
- Fiscal Year Engine **Phase 6** (per-month period-lock polish) and wider fiscal-year integration; only the
  Transaction Register has the "All time" + FY column.
- Login/failed-login audit events, a `transferOwnership()` action, `payroll.view_salary`-style sub-permissions.
- `memberships.permissions` (per-member override) is unused now that roles exist; safe to drop in a cleanup.
- Recurring Expenses feature: see the saved memory note for its phase status (not re-checked recently).
- Global UI redesign: postponed on purpose (plan saved in memory).
- Possible next imports: line-item layout for Sales, Stockable purchases, customers/suppliers/opening
  balances/items/assets.
- Compliance leftovers: "Annual Company Compliance" has no due rule so no catch-up stream; an excisable-item
  flag and sales block; a "receipts by mode" report; posting the money for an excise renewal automatically.
  The platform admin has no screen yet for tax rates or requirement templates (only fines and penalties).

## Known data quirks (don't mistake these for bugs)

- DS Finance also carries demo compliance data (company registered 2078/10/20, VAT effective 2080/10/20 monthly,
  an excise permit with renewals through 2082/83, a saved checklist through Ashadh 2083) and payment modes
  Cash / Bank transfer linked to its accounts.
- Integration tests that fail on a clean checkout too (not caused by recent work): "stock that has already been
  sold can't be taken back out by voiding", the sales/purchase **returns** tests, and the assets cash-flow
  depreciation add-back test.
- The primary demo tenant is **"DS Finance group"** — its inventory-vs-ledger difference on the Stock Summary
  report is **intentional test-data leftover**. It also holds many **voided/reversed test records** from live
  verification (voided test invoices/bills incl. `ZZ-B1/B2/B4`, voided test assets, reversed depreciation
  runs); numbers used by voided documents are never reused. Treat as clutter, not corruption.
- Demo/seed accounts live in `src/db/seed.ts` (platform admin and a demo owner). Sessions in the Browser pane
  expire; when verifying locally, sign in with those seed accounts or throwaway users you create and delete.
- One integration test is flaky and fails on a clean checkout too: "stock that has already been sold can't be
  taken back out by voiding" (purchases). ESLint reports a handful of pre-existing errors in untouched files
  (e.g. `payroll/setup/settings-form.tsx`).

## Verification pattern to keep using

For any DB-level check that can't go through the browser, write a throwaway script (repo root, e.g.
`tmp-check-*.ts`, or an inline `node --env-file=.env.local -e` using the `postgres` package), run it with
`node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs <file>`, then delete it — never commit temp
scripts. Test users created for live checks must be deleted afterwards (delete their `audit_log` rows first).
Shell note: heredocs/`node -e` with apostrophes break in this Git Bash — write files with the Write tool.
