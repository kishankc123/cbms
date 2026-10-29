import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// Tenant isolation, static layer (no database needed). Organizations are tenants: every row that belongs to one
// carries a tenant_id, and every query that looks a row up by its id must ALSO filter on the tenant, otherwise a
// member of organization A who learns (or guesses) an id from organization B can read or change B's data.
//
// 1. The schema: each table either has a tenant_id (NOT NULL, pointing at tenants) or is on the reviewed list of
//    tables that are global on purpose.
// 2. The code: every `.where(...)` that matches a tenant-scoped table by id also mentions that table's tenantId,
//    unless the place is on the reviewed list below with a reason.

const SRC = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.int\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, "/");

type Info = { exportName: string; sqlName: string; tenantColumn: ReturnType<typeof getTableConfig>["columns"][number] | undefined };
const tables: Info[] = [];
for (const [exportName, value] of Object.entries(schema)) {
  if (!(value instanceof PgTable)) continue;
  const cfg = getTableConfig(value as never);
  tables.push({ exportName, sqlName: cfg.name, tenantColumn: cfg.columns.find((c) => c.name === "tenant_id") });
}
const scoped = tables.filter((t) => t.tenantColumn);

// Tables with no tenant_id on purpose. Anything new must be added here with a reason, or given a tenant_id.
const GLOBAL_TABLES: Record<string, string> = {
  tenants: "the organization itself",
  users: "users are global; they join organizations through memberships",
  accounts: "NextAuth adapter table (user-level sign-in providers)",
  sessions: "NextAuth adapter table",
  verification_tokens: "NextAuth adapter table",
};

describe("every table is either tenant-scoped or reviewed as global", () => {
  it("finds the tables", () => {
    expect(tables.length).toBeGreaterThan(80);
  });

  it("has a reason for each table without a tenant_id", () => {
    const unexplained = tables.filter((t) => !t.tenantColumn && !(t.sqlName in GLOBAL_TABLES) && !PLATFORM_OR_CHILD(t.sqlName)).map((t) => t.sqlName);
    expect(unexplained, "add a tenant_id, or list the table in GLOBAL_TABLES / CHILD_TABLES with a reason").toEqual([]);
  });

  it("makes tenant_id NOT NULL on every scoped table except platform-level rows", () => {
    const nullable = scoped.filter((t) => !t.tenantColumn!.notNull && !(t.sqlName in NULLABLE_TENANT_OK)).map((t) => t.sqlName);
    expect(nullable, "tenant_id should be NOT NULL, or list the table in NULLABLE_TENANT_OK with a reason").toEqual([]);
  });
});

/** Child rows reached only through a parent that is tenant-scoped (their parent's lookup does the tenant check). */
const CHILD_TABLES: Record<string, string> = {
  journal_lines: "belongs to a journal entry; always reached through postJournalEntry / the entry's tenant",
  payment_allocations: "belongs to a payment, which carries the tenant",
  bank_reconciliation_match_lines: "belongs to a reconciliation match, which carries the tenant",
  bank_reconciliation_match_journal_lines: "belongs to a reconciliation match, which carries the tenant",
};
/** Platform-level tables: written by platform administrators, shared by every organization or limited to a user. */
const PLATFORM: Record<string, string> = {
  auth_tokens: "user-level tokens (email verification, password reset); the user is global",
  compliance_countries: "platform compliance configuration",
  compliance_entity_types: "platform compliance configuration",
  compliance_categories: "platform compliance configuration",
  compliance_authorities: "platform compliance configuration",
  compliance_tax_types: "platform compliance configuration",
  compliance_tax_heads: "platform compliance configuration",
  compliance_requirement_templates: "platform compliance configuration",
  compliance_penalty_rules: "platform compliance configuration",
  platform_tax_rates: "published by platform administrators; copied into each organization as tax_rates",
};
/** Tables where tenant_id may be NULL: rows that belong to the platform, not an organization. */
const NULLABLE_TENANT_OK: Record<string, string> = {
  audit_log: "platform-admin actions are logged with a null tenant",
  email_log: "mail not sent on behalf of an organization (sign-up, password reset) has no tenant",
};
function PLATFORM_OR_CHILD(name: string) {
  return name in CHILD_TABLES || name in PLATFORM;
}

/** Index of the parenthesis that closes the one opened at `open`. */
function closeOf(s: string, open: number) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return s.length;
}

type Hit = { file: string; line: number; kind: "read" | "write"; table: string };

/** Every `eq(table.id, x)` / `inArray(table.id, xs)` on a tenant-scoped table that sits inside a `.where(...)` with no `table.tenantId` in it. */
function unscopedLookups(): Hit[] {
  const scopedByExport = new Map(scoped.map((t) => [t.exportName, t]));
  const hits: Hit[] = [];
  for (const file of [...walk(path.join(SRC, "lib")), ...walk(path.join(SRC, "app"))]) {
    const s = read(file);
    const re = /\b(?:eq|inArray)\(\s*(\w+)\.id\s*,/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (!scopedByExport.has(m[1])) continue;
      // The `.where(` this condition sits inside (join conditions are not inside one, and are skipped).
      let start = s.lastIndexOf(".where(", m.index);
      let end = -1;
      while (start !== -1) {
        end = closeOf(s, start + ".where".length);
        if (end > m.index) break;
        start = s.lastIndexOf(".where(", start - 1);
      }
      if (start === -1) continue;
      if (new RegExp(`\\b${m[1]}\\.tenantId\\b`).test(s.slice(start, end + 1))) continue;
      // The nearest statement verb before the where tells a write (update/delete) from a read.
      const before = s.slice(Math.max(0, start - 600), start);
      const verb = Math.max(before.lastIndexOf(".update("), before.lastIndexOf(".delete("));
      const kind = verb !== -1 && verb > before.lastIndexOf(".select(") && verb > before.lastIndexOf(".from(") ? "write" : "read";
      hits.push({ file: rel(file), line: s.slice(0, m.index).split("\n").length, kind, table: m[1] });
    }
  }
  return hits;
}

/**
 * Lookups by id that carry no tenant filter, per file, as counted on 2026-10-11. Each one works on an id taken from a
 * row that was ALREADY fetched with the tenant filter (a second-level lookup, or a write right after a checked read),
 * or is a report helper over ids it just selected for the tenant. It is a ratchet: a count may go down but never up,
 * and a file not listed here may not have any. When you write a query, put the tenant in it:
 *   .where(and(eq(t.id, id), eq(t.tenantId, tenantId)))
 * Writes are included on purpose: a write that trusts an earlier read has no second line of defence.
 */
const BASELINE: Record<string, number> = {
  "app/(app)/assets/setup/actions.ts": 3,
  "app/(app)/audit/actions.ts": 3,
  "app/(app)/bank-reconciliation/actions.ts": 9,
  "app/(app)/compliance/actions.ts": 2,
  "app/(app)/compliance/registration-actions.ts": 1,
  "app/(app)/compliance/statutory-actions.ts": 2,
  "app/(app)/compliance/tax-actions.ts": 1,
  "app/(app)/customers/actions.ts": 3,
  "app/(app)/expenses/actions.ts": 6,
  "app/(app)/expenses/recurring/[id]/page.tsx": 1,
  "app/(app)/payments/actions.ts": 6,
  "app/(app)/payroll/employees/actions.ts": 3,
  "app/(app)/payroll/employees/attendance-actions.ts": 1,
  "app/(app)/payroll/salary-sheet/actions.ts": 6,
  "app/(app)/purchases/actions.ts": 4,
  "app/(app)/return/purchase/actions.ts": 2,
  "app/(app)/return/sales/actions.ts": 2,
  "app/(app)/sales/actions.ts": 2,
  "app/(app)/settings/fiscal-years/actions.ts": 2,
  "app/(app)/settings/users/actions.ts": 3,
  "app/(app)/suppliers/actions.ts": 3,
  "app/accept-invite/actions.ts": 1,
  "lib/assets/disposal.ts": 6,
  "lib/assets/opening.ts": 4,
  "lib/assets/purchase.ts": 5,
  "lib/assets/register.ts": 1,
  "lib/assets/run.ts": 3,
  "lib/compliance/assessments.ts": 1,
  "lib/compliance/catchup.ts": 5,
  "lib/compliance/engine/legacy-migration.ts": 1,
  "lib/compliance/excise-permit.ts": 3,
  "lib/compliance/platform-tax-rates.ts": 1,
  "lib/compliance/tax-accounts.ts": 1,
  "lib/compliance/tax-amounts.ts": 1,
  "lib/compliance/template-admin.ts": 1,
  "lib/compliance/vat-worksheet-store.ts": 3,
  "lib/expenses/expense-records.ts": 1,
  "lib/expenses/import/service.ts": 1,
  "lib/ledger/advance-accounts.ts": 3,
  "lib/ledger/inter-transfers.ts": 2,
  "lib/ledger/payments-engine.ts": 15,
  "lib/ledger/payroll-accounts.ts": 1,
  "lib/ledger/post.ts": 1,
  "lib/ledger/purchase-by-item.ts": 3,
  "lib/ledger/purchase-by-supplier.ts": 3,
  "lib/ledger/purchase-summary.ts": 2,
  "lib/ledger/sales-by-customer.ts": 3,
  "lib/ledger/sales-by-item.ts": 3,
  "lib/ledger/sales-summary.ts": 2,
  "lib/ledger/subledger-accounts.ts": 2,
  "lib/org-members.ts": 3,
  "lib/org-ownership.ts": 2,
  "lib/ownership/service.ts": 8,
  "lib/payment-modes.ts": 2,
  "lib/payroll/accrual.ts": 1,
  "lib/payroll/payroll-summary.ts": 1,
  "lib/payroll/staff-advances.ts": 1,
  "lib/purchases/bill-records.ts": 1,
  "lib/purchases/import/service.ts": 1,
  "lib/recurring-expenses/generate.ts": 2,
  "lib/role-store.ts": 4,
  "lib/sales/import/service.ts": 1,
  "lib/sales/invoice-records.ts": 2,
};

describe("every lookup by id also filters on the tenant", () => {
  const hits = unscopedLookups();
  const perFile = new Map<string, number>();
  for (const h of hits) perFile.set(h.file, (perFile.get(h.file) ?? 0) + 1);

  it("adds no unscoped lookup beyond the reviewed baseline", () => {
    const worse = [...perFile].filter(([f, n]) => n > (BASELINE[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${BASELINE[f] ?? 0}) at lines ${hits.filter((h) => h.file === f).map((h) => h.line).join(", ")}`);
    expect(worse, "a query looks a row up by id without filtering on the tenant").toEqual([]);
  });

  it("keeps the baseline honest (lower it when a file is fixed)", () => {
    const stale = Object.entries(BASELINE).filter(([f, n]) => (perFile.get(f) ?? 0) < n).map(([f, n]) => `${f}: ${perFile.get(f) ?? 0} now, baseline ${n}`);
    expect(stale, "lower these numbers in BASELINE").toEqual([]);
  });
});
