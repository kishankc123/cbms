# Next steps

Prioritized path to a production-ready product, based on the gaps recorded in `CLAUDE.md`.
Tick items off as they are finished. Only commit and push when explicitly asked.

## Decisions made

- Stay on Vercel for now; consider migrating hosting later only if a concrete reason appears
  (in-country data residency requirement by contract, compute cost, long-running workers).
- Customers are in Nepal: put the Neon database and the Vercel function region in the same region
  close to Nepal (Mumbai `aws-ap-south-1` or Singapore).
- The current Neon database holds real user data, so it **becomes production**. The development
  database is a separate one (empty plus `seed.ts`, or a scrubbed branch).
- Git flow: `feature/*` → `development` → `main` (production).
- Keep Vercel-only services (Blob, Queues, Runtime Cache, BotID) behind small wrappers in `src/lib`
  so a later host move stays cheap. Keep all configuration in environment variables.

## Done

- [x] `.env*` is gitignored; no env file or `postgres://` string ever committed
- [x] `development` branch created from `main` and pushed
- [x] Separate development database created in Neon
- [x] Preview environment variables set in Vercel

## 1. Blockers before production

- [ ] **Environments and secrets**
  - [ ] Vercel → Settings → Git: Production Branch is `main`
  - [ ] `DATABASE_URL` and `AUTH_SECRET` set separately for Production, Preview and Development
        (generate each with `openssl rand -base64 32`; mark Sensitive; never reuse across environments)
  - [ ] Preview deployments cannot see the production `DATABASE_URL`
  - [ ] Deployment Protection on for previews
  - [ ] Rotate `AUTH_SECRET` and the production DB password
  - [ ] Optional: stable staging URL for the `development` branch
- [ ] **GitHub branch protection on `main`**: require a PR, require status checks, block force pushes
- [ ] **Migrations as a release step** (deploys do not run migrations)
  - [ ] Compare the host of the production `DATABASE_URL` with `.env.local`
  - [ ] Back up production in Neon before each migration; test a restore once
  - [ ] Order: apply to development first, test, back up production, migrate production, then release
  - [ ] Run migrations 0065–0092 where missing; deploy the code **before** running 0092
        (it drops `memberships.permissions`)
- [ ] **Shared rate limiting**: `src/lib/rate-limit.ts` is in-memory and ineffective on serverless.
      Move to a shared store; apply to login, signup, reset, invitations, imports. Consider BotID / WAF rules.
- [ ] **Real email provider**: verification, invitations, resets, member-added notices; SPF, DKIM, DMARC
- [ ] **Region alignment**: Neon region and Vercel function region both near Nepal and matching

## 2. Security hardening

- [ ] **Tenant isolation tests**: sign in as org A, try every entity of org B by ID
      (invoices, payments, imports, reports, attachments). Consider Postgres Row-Level Security as a second layer.
- [ ] **Authorization review** of money-moving actions (void, edit payment, reopen period, ownership transfer);
      IDOR check on every `[id]` route and every import step
- [ ] **Authentication**: MFA (TOTP) for Owners, Administrators, platform admins; password policy and hashing
      parameters; single-use short-lived reset tokens; session lifetime; force sign-out and disable take effect
      immediately; no user enumeration through responses or timing
- [ ] **Input and upload safety**: Zod validation on every server action; import size, type and row caps;
      spreadsheet formula-injection guard on exports and templates; large uploads via direct Blob upload
      (request bodies are limited to 4.5 MB, the server-action limit is 4 MB)
- [ ] **HTTP security headers** in `next.config.ts`: CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors`,
      Referrer-Policy
- [ ] **Dependencies**: `npm audit`, handle the open Dependabot branches
- [ ] **Data protection**: consider field-level protection for PAN / VAT numbers and bank details; scrub PII
      from logs and error messages; retention policy; data export and delete process
- [ ] **Audit log integrity**: append-only at the database-role level; least-privilege app DB role, separate
      from the migration role

## 3. Product completeness

- [ ] Billing (still a placeholder): plans, limits, payment provider
- [ ] Staff sees dashboard KPIs: add a dashboard-financials special permission, or turn off Chart of Accounts
      view for Staff
- [ ] Import Sales posts in one request: post in slices like Purchases, or use Queues / Workflow
- [ ] Fiscal Year Engine Phase 6 (per-month period-lock polish)
- [ ] Fix the known failing integration tests: stock void, sales/purchase returns, assets cash-flow
      depreciation add-back
- [ ] Clear the existing ESLint errors so lint can be a required check
- [ ] Compliance: confirm the unverified excise-permit bands and income-tax template with a Nepal tax professional
- [ ] Optional later: more imports (customers, suppliers, opening balances, items); transfers, bulk import and
      reports for assets; tax depreciation

## 4. Reliability and operations

- [ ] CI on every PR: `tsc --noEmit`, `eslint`, `vitest`, integration tests; `permission-coverage.test.ts` required
- [ ] Error tracking (Sentry or similar), uptime checks, alerts on failed logins and lockouts
- [ ] Backups: Neon point-in-time recovery with a documented restore drill
- [ ] Performance: indexes and query plans on `journal_lines` and `tenantId` composites; load-test reports
      (VAT worksheet Load) with realistic data
- [ ] Custom domain: add it in Vercel, set DNS, then update `AUTH_URL`, the cookie domain if set, and the
      email sender domain
- [ ] Global UI redesign (postponed on purpose) after security and correctness work

## 5. Process and launch

- [ ] Security checklist for each new feature
- [ ] External penetration test before real customers
- [ ] Privacy policy, terms of service, breach-response runbook
- [ ] User acceptance testing with 2–3 real Nepali businesses
- [ ] Check with a local lawyer whether any customers (banks, government) require in-country hosting

## Suggested order

1. Environments and secrets, branch protection, migrations process, shared rate limiting, real email.
2. Tenant-isolation and IDOR test suite, then MFA and security headers.
3. Staff dashboard permission, import slicing, failing tests, CI.
4. Monitoring, backups, custom domain.
5. Billing, penetration test, UAT, launch.
