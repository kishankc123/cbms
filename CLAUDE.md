@AGENTS.md

# Development Context (for continuing in a new session)

Last updated: 2026-09-29, as of commit `454e9e7` on `main`, with Phase 5 of the Fiscal Year Engine
built and verified locally but **not yet committed** (see item 3 below — check `git status` first thing
in a new session).

## What this app is

A multi-tenant accounting SaaS for Nepal (Next.js 16 App Router, Drizzle ORM, Neon Postgres, NextAuth v5,
Tailwind). Dual AD/BS (Bikram Sambat) calendar support throughout — dates are always stored as AD
`YYYY-MM-DD`; BS is derived for display/entry via `src/lib/calendar/` (the single calendar engine; never
duplicate date math elsewhere). Git user for this repo: kishankc123.

## Core architectural principles (already established, keep following them)

- **Multi-tenant via `tenantId`**, scoped on every query. A user can belong to multiple organizations
  (`memberships` table, many-to-many); "active organization" is session-scoped (`activeTenantId`), not a
  column on the user.
- **Journal entries are the ledger's single source of truth.** Every module (Sales, Purchases, Expenses,
  Payments, Payroll, Inventory, manual Journal) posts through `postJournalEntry()` /
  `reverseJournalEntry()` in `src/lib/ledger/post.ts` — the one choke point. Never insert into
  `journal_entries`/`journal_lines` directly from a module.
- **Reports never recreate accounting logic.** They always read from `journal_entries`/`journal_lines`
  via `src/lib/ledger/reports.ts` and sibling files (`src/lib/ledger/sales-summary.ts`,
  `purchase-summary.ts`, `receivable-ageing.ts`, etc.) — never a second computation that could disagree
  with the official numbers. Every report was cross-checked against at least one other report for
  consistency before being called done.
- **Permissions**: `can(session, module, action)` in `src/lib/session.ts`, modules listed in
  `src/lib/roles.ts` (`audit, bank_reconciliation, chart_of_accounts, compliance, expenses, inventory,
  payments, payroll, purchases, sales, settings`), actions are `view/create/edit/delete`. Roles:
  `owner, admin, accountant, staff` — owner/admin bypass all checks. Every new page/action must call
  `can()` explicitly; it is **not** automatic. (A real gap here — payroll/report pages missing `can()`
  checks — was found and fixed this session, see item 2 below. Stay vigilant for the same mistake on new
  pages.)
- **Audit logging**: `logAuditEvent()` in `src/lib/audit.ts`, append-only, tenant-scoped.
- **Close/reopen pattern** (used for accounting periods, bank reconciliations, and fiscal years alike):
  closing is a routine action gated on `edit` permission; reopening is admin-only, requires a reason, and
  is always audit-logged. Follow this exact shape for any future close/reopen feature.
- Build **phase by phase**, verify live in the browser (built-in Browser pane) plus `npx tsc --noEmit`,
  `npx eslint`, and `npm test` before calling a phase done, then **pause for the user's explicit go-ahead**
  before continuing to the next phase. **Only commit/push when explicitly asked** — work sits uncommitted
  between phases by design.
- Drizzle migrations: generate with
  `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs generate`, apply with `...migrate`
  (the plain `npx drizzle-kit` shim breaks under this shell — always call the `.cjs`/`.mjs` entry
  directly). A data backfill can be hand-appended to a generated migration's `.sql` file.

## What's been built this session (all committed except where noted)

### 1. Reports module — complete, all 29 reports across 7 phases (commits `f715caf`..`e6c01e5`)
Landing page at `/reports` (`src/app/(app)/reports/report-catalog.ts` drives it — one row per report).
Covers Financial Statements, Ledger & Accounting, Sales/Purchases & Receivables/Payables, Cash & Bank,
Inventory, Payroll. Two real bugs were caught and fixed during build (not left as known issues):
unitemized invoices/bills (Multi-invoice/batch flow doesn't store line items) were rolled into an
explicit "Not itemized" row so by-item reports still tie to their Summary report's total; vendor-less
Consumable purchases got a "No Supplier" row in Purchase by Supplier for the same reason.

### 2. Permission gaps fixed (commit `8e1666d`)
`journal/actions.ts`'s manual-entry create/reverse, and all 25 report pages, were missing `can()` checks
entirely (any signed-in tenant member — including `staff`, denied payroll access by default — could see
Payroll Summary/Salary Payable, and could post/reverse manual journal vouchers). Fixed by mapping each
report to the module whose data it exposes (financial statements → `chart_of_accounts`, sales reports →
`sales`, payroll reports → `payroll`, etc.) and gating journal actions on `chart_of_accounts`.

### 3. Fiscal Year & Accounting Period Engine — Phases 1-4 committed (`f438f3e`, `90d5811`, `454e9e7`),
### **Phase 5 built and verified but NOT yet committed** — check `git status` / ask the user before continuing.

Core files: `src/db/schema/fiscal.ts` (new `fiscal_years` table, one row per fiscal year per tenant, with
`open/closed/reopened` status — replaces the old single mutable start/end pair on `tenants`, which had no
history), `src/lib/fiscal.ts` (the service: `getCurrentFiscalYear`, `getFiscalYearByDate`,
`listFiscalYears`, `createFiscalYear`, `assertFiscalYearOpen`, `resolveFiscalYearId`,
`getActiveFiscalYear`/cookie-based sidebar context, `fiscalYearDefaultRange`/`fiscalYearDefaultAsOf` for
report defaults), `src/lib/fiscal-closing.ts` (year-end readiness checklist + opening-balance
reconciliation, **uncommitted**).

- **Phase 1**: the `fiscal_years` table + service; `getFiscalRange()` rewritten to read from it (same
  signature, so all report pages picked it up for free); `assertFiscalYearOpen()` wired into the central
  posting path; Settings → Fiscal Years page (list/add/close/reopen).
- **Phase 2**: global fiscal-year switcher in the sidebar (`src/app/(app)/fiscal-year-switcher.tsx` +
  `fiscal-year-actions.ts`, cookie-based, per-tenant), an `all_time` preset added to
  `src/lib/calendar/service.ts`, Transaction Register wired as the first report to read the switcher's
  context (FY column in All Time mode).
- **Phase 3**: `journal_entries.fiscal_year_id` column (FK), stamped at posting time via
  `resolveFiscalYearId()` in the central `postJournalEntry()`/`reverseJournalEntry()` path — covers every
  module automatically. Historical backfill migration included. Recorded once at posting time (not
  recomputed from date on every read) so a later fix to a fiscal year's boundaries can't reassign an
  already-posted transaction's year.
- **Phase 4**: every report page's default period now follows the sidebar's active fiscal-year context
  (`fiscalYearDefaultRange`/`fiscalYearDefaultAsOf` in `lib/fiscal.ts`) instead of a hardcoded
  "this month" — an explicit `?from=`/`?to=` in the URL still wins.
- **Phase 5 (uncommitted)**: year-end closing readiness checklist (draft invoices/bills, unbalanced
  trial balance/balance sheet, negative stock) reusing existing report functions; the existing
  `closeFiscalYear` action now enforces this checklist server-side; opening-balance reconciliation
  comparing a closed year's final Balance Sheet to the next year's first day. **Deliberate design
  decision, stated to the user**: this does NOT post literal closing/zeroing journal entries for
  revenue/expense accounts, because `balanceSheet()`'s retained earnings is already computed live by
  summing all P&L activity since epoch (see that function's own comment) — posting closing entries would
  corrupt any future cross-year custom-range P&L report for no benefit. If the user pushes back on this
  and wants literal closing entries per the spec's letter, that needs a real design conversation first,
  not a quick patch.

## What's explicitly NOT built (reviewed/audited, deliberately deferred)

- **Fixed Assets module** — doesn't exist at all (no schema, no pages). Confirmed via audit. Any
  Dashboard or Fiscal Year spec item referencing assets/depreciation needs this built first.
- **Interactive Financial Dashboard** — only a minimal placeholder exists at `/dashboard`
  (`src/app/(app)/dashboard/page.tsx`, a few KPI cards). The full spec (revenue/expense/profit KPIs,
  ageing/inventory/compliance widgets, drill-down, "Needs Attention", charts) was reviewed and audited
  in detail but not built — the user chose to build the Fiscal Year Engine first. Known blockers found
  during that audit: no charting library installed; no caching layer anywhere (a naive dashboard
  importing many report functions could trigger 35-60+ DB round-trips per load — needs a dedicated
  lightweight aggregate-query layer, not reused report functions).
- **Full User Access Control spec** — audited in detail; the existing model (multi-org membership,
  session-fresh permissions every request, tenant-scoped queries, secure invitations, append-only audit
  log, platform-admin isolation) already matches the spec closely. Real gaps found: permission
  granularity is coarse CRUD only (no `payroll.view_salary`-style sub-actions); no dedicated
  `transferOwnership()` action (self-escalation is already blocked by other means, so lower urgency); no
  login/failed-authentication audit events.
- **Fiscal Year Engine Phase 6** (period-locking UI polish, e.g. per-month lock granularity) and
  broader Dashboard integration of the fiscal-year context — not started.
- Only **Transaction Register** has an "All Time" + FY-column treatment; the other reports respect the
  fiscal-year default range but don't show an FY column (that was intentionally scoped to one flagship
  report as a proof, not rolled out everywhere).

## Known data quirks (don't mistake these for bugs)

- The primary demo tenant is **"DS Finance group"** — treat its inventory-vs-ledger difference on the
  Stock Summary report as **intentional test-data leftover**, not a bug (already flagged once this
  session). Re-verify with real client data before assuming it's fixed.
- No real draft sales invoices/purchase bills exist anywhere in the current dataset, so the Phase 5
  closing-readiness "draft transaction" check has only been logic-verified, not exercised against real
  blocking data.
- The browser session used for live verification during this work was logged in as the **`accountant`**
  role (not owner/admin), which is why some `settings:edit`-gated actions (like actually closing a fiscal
  year) had to be verified via a throwaway script against a different test tenant instead of the live UI.

## Verification pattern to keep using

For any DB-level check that can't go through the browser (e.g. testing a permission-gated action, or
confirming a migration backfilled correctly), write a throwaway `tmp-check-*.ts` script at the repo root,
run it with `node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs tmp-check-*.ts`, then delete it —
never leave temp scripts committed.
