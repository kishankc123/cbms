import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, tenants } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { todayIso } from "@/lib/calendar";
import { cashFlow } from "./cash-flow";
import { cashAndBankBreakdown, dashboardKpis, needsAttention } from "./aggregates";
import { upcomingParties, upcomingSummary } from "./upcoming";
import { loadForecast } from "./forecast";
import { loadPlanning } from "./planning";
import { loadCashCycle } from "./cash-cycle";

// How the dashboard holds up on a large organization. Opt-in (it builds about 100,000 documents and 250,000 ledger lines in a
// throwaway organization, then removes them): PERF_SCALE=1 npm run test:integration -- scale
// PERF_SCALE=20000 makes the invoices that many (bills, expenses and payments follow in proportion).
const SCALE = Number(process.env.PERF_SCALE ?? 0);
const enabled = SCALE > 0;
const N_INV = SCALE > 1 ? SCALE : 30_000;

let org: Awaited<ReturnType<typeof createTempOrg>>;
const today = todayIso();
const t0 = () => performance.now();
// The database is usually far away from the machine running this test (every query here crosses the internet), and a page makes many
// queries one after another, so the wall-clock time says more about the distance than about the work. Each figure therefore also
// reports how many queries it ran and the time left once the round trips are taken off: that is what the database and the data
// transfer cost, and it is what a server sitting next to the database would see.
// Written straight to the terminal: the test runner hides console output of a passing test.
const out = (text: string) => void process.stdout.write(`${text}\n`);
let queries = 0;
let roundTrip = 0;
const client = (db as unknown as { $client: { unsafe: (...args: unknown[]) => unknown } }).$client;
const unsafe = client.unsafe.bind(client);
const slowQueries: { ms: number; text: string; params: unknown[] }[] = [];
client.unsafe = (...args: unknown[]) => {
  queries++;
  const start = performance.now();
  const pending = unsafe(...args) as Promise<unknown>;
  Promise.resolve(pending).then(
    () => void slowQueries.push({ ms: Math.round(performance.now() - start), text: String(args[0]), params: (args[1] as unknown[]) ?? [] }),
    () => undefined,
  );
  return pending;
};
const timings: { name: string; ms: number; queries: number; withoutTravel: number }[] = [];
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const before = queries;
  const start = t0();
  const out = await fn();
  const ms = Math.round(performance.now() - start);
  const n = queries - before;
  timings.push({ name, ms, queries: n, withoutTravel: Math.max(Math.round(ms - n * roundTrip), 0) });
  return out;
}

async function exec(q: ReturnType<typeof sql>) {
  await db.execute(q);
}

// Plain scratch tables rather than temporary ones: the database sits behind a connection pool, where a temporary table can be gone (or left behind) between two statements.
const SCRATCH = ["perf_c", "perf_v", "perf_i", "perf_k", "perf_r", "perf_b", "perf_bp", "perf_e"];
const dropScratch = async () => {
  for (const name of SCRATCH) await db.execute(sql.raw(`drop table if exists ${name}`));
};

async function build() {
  await dropScratch();
  const t = org.tenantId;
  const u = org.userId;
  const byCode = async (code: string) => (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, t), eq(accounts.code, code))))[0].id;
  const [cash, ar, ap, revenue, cogs, inventory] = await Promise.all(["1000", "1100", "2000", "4000", "5000", "1200"].map(byCode));
  const [expenseAcct] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.tenantId, t), eq(accounts.category, "expense"), sql`${accounts.code} <> '5000' and ${accounts.code} not like '5000.%'`)).limit(1);
  const nBill = Math.round(N_INV / 2);
  const nExp = Math.round(N_INV / 3);

  await exec(sql`insert into customers (tenant_id, name) select ${t}::uuid, 'Perf customer ' || g from generate_series(1, 300) g`);
  await exec(sql`insert into vendors (tenant_id, name) select ${t}::uuid, 'Perf supplier ' || g from generate_series(1, 60) g`);
  await exec(sql`create table perf_c as select id, row_number() over () rn from customers where tenant_id = ${t}::uuid`);
  await exec(sql`create table perf_v as select id, row_number() over () rn from vendors where tenant_id = ${t}::uuid`);

  // Sales invoices: 70% paid, the rest open in different states. Each has its own journal entry (Dr receivable, Cr sales).
  await exec(sql`create table perf_i as
    select g i, gen_random_uuid() id, gen_random_uuid() pay_entry, gen_random_uuid() pay_id,
           (current_date - (random() * 360)::int) dt,
           round((500 + random() * 49500)::numeric, 2) total,
           case when g % 20 < 14 then 'paid' when g % 20 < 18 then 'sent' when g % 20 = 18 then 'partially_paid' else 'overdue' end status
    from generate_series(1, ${N_INV}::int) g`);
  await exec(sql`insert into sales_invoices (id, tenant_id, customer_id, invoice_number, invoice_date, due_date, gross_amount, subtotal, tax_amount, total, status, amount_paid)
    select i.id, ${t}::uuid, c.id, 'P-' || i.i, i.dt, i.dt + 30, i.total, i.total, 0, i.total, i.status::invoice_status,
           case i.status when 'paid' then i.total when 'partially_paid' then round(i.total / 2, 2) else 0 end
    from perf_i i join perf_c c on c.rn = 1 + (i.i % 300)`);
  await exec(sql`insert into journal_entries (id, tenant_id, entry_date, source_type, source_id, created_by) select id, ${t}::uuid, dt, 'sale', id, ${u}::uuid from perf_i`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${ar}::uuid, total, 0 from perf_i`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${revenue}::uuid, 0, total from perf_i`);

  // Cost of goods sold on a third of the sales.
  await exec(sql`create table perf_k as select gen_random_uuid() id, i.id sale_id, i.dt, round(i.total * 0.55, 2) cost from perf_i i where i.i % 3 = 0`);
  await exec(sql`insert into journal_entries (id, tenant_id, entry_date, source_type, source_id, created_by) select id, ${t}::uuid, dt, 'sale', sale_id, ${u}::uuid from perf_k`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${cogs}::uuid, cost, 0 from perf_k`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${inventory}::uuid, 0, cost from perf_k`);

  // Receipts for the paid invoices, each allocated to its invoice (this is what the payment history is learned from).
  await exec(sql`create table perf_r as select i.*, least(i.dt + 5 + (random() * 55)::int, current_date) paid_on from perf_i i where i.status = 'paid'`);
  await exec(sql`insert into journal_entries (id, tenant_id, entry_date, source_type, source_id, created_by) select pay_entry, ${t}::uuid, paid_on, 'receipt', pay_id, ${u}::uuid from perf_r`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select pay_entry, ${cash}::uuid, total, 0 from perf_r`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select pay_entry, ${ar}::uuid, 0, total from perf_r`);
  await exec(sql`insert into payments_ledger (id, tenant_id, payment_number, direction, payment_type, payment_date, party_type, customer_id, account_id, amount, status, journal_entry_id, created_by)
    select r.pay_id, ${t}::uuid, 'PR-' || r.i, 'money_in', 'customer_payment', r.paid_on, 'customer', c.id, ${cash}::uuid, r.total, 'posted', r.pay_entry, ${u}::uuid
    from perf_r r join perf_c c on c.rn = 1 + (r.i % 300)`);
  await exec(sql`insert into payment_allocations (payment_id, target_type, target_id, allocated_amount) select pay_id, 'sales_invoice', id, total from perf_r`);

  // Supplier bills (credit), 60% paid, each with a journal entry and, when paid, a payment out.
  await exec(sql`create table perf_b as
    select g i, gen_random_uuid() id, gen_random_uuid() pay_entry, gen_random_uuid() pay_id,
           (current_date - (random() * 360)::int) dt,
           round((300 + random() * 30000)::numeric, 2) total,
           case when g % 10 < 6 then 'paid' when g % 10 < 8 then 'open' when g % 10 = 8 then 'partially_paid' else 'overdue' end status
    from generate_series(1, ${nBill}::int) g`);
  await exec(sql`insert into purchase_bills (id, tenant_id, vendor_id, bill_number, bill_date, due_date, subtotal, tax_amount, total, status, amount_paid, purchase_type)
    select b.id, ${t}::uuid, v.id, 'PB-' || b.i, b.dt, b.dt + 30, b.total, 0, b.total, b.status::bill_status,
           case b.status when 'paid' then b.total when 'partially_paid' then round(b.total / 2, 2) else 0 end, 'credit'
    from perf_b b join perf_v v on v.rn = 1 + (b.i % 60)`);
  await exec(sql`insert into journal_entries (id, tenant_id, entry_date, source_type, source_id, created_by) select id, ${t}::uuid, dt, 'purchase', id, ${u}::uuid from perf_b`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${inventory}::uuid, total, 0 from perf_b`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${ap}::uuid, 0, total from perf_b`);
  await exec(sql`create table perf_bp as select b.*, least(b.dt + 10 + (random() * 40)::int, current_date) paid_on from perf_b b where b.status = 'paid'`);
  await exec(sql`insert into journal_entries (id, tenant_id, entry_date, source_type, source_id, created_by) select pay_entry, ${t}::uuid, paid_on, 'payment', pay_id, ${u}::uuid from perf_bp`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select pay_entry, ${ap}::uuid, total, 0 from perf_bp`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select pay_entry, ${cash}::uuid, 0, total from perf_bp`);
  await exec(sql`insert into payments_ledger (id, tenant_id, payment_number, direction, payment_type, payment_date, party_type, vendor_id, account_id, amount, status, journal_entry_id, created_by)
    select p.pay_id, ${t}::uuid, 'PS-' || p.i, 'money_out', 'supplier_payment', p.paid_on, 'supplier', v.id, ${cash}::uuid, p.total, 'posted', p.pay_entry, ${u}::uuid
    from perf_bp p join perf_v v on v.rn = 1 + (p.i % 60)`);

  // Expenses, 70% paid, each with a journal entry (Dr expense, Cr cash when paid else payable).
  await exec(sql`create table perf_e as
    select g i, gen_random_uuid() id, (current_date - (random() * 360)::int) dt, round((100 + random() * 8000)::numeric, 2) total,
           case when g % 10 < 7 then 'paid' else 'unpaid' end status
    from generate_series(1, ${nExp}::int) g`);
  await exec(sql`insert into expenses (id, tenant_id, expense_number, expense_date, due_date, category_account_id, taxable_amount, subtotal, total, amount_payable, amount_paid, status)
    select id, ${t}::uuid, 'PE-' || i, dt, dt + 15, ${expenseAcct.id}::uuid, total, total, total, total, case status when 'paid' then total else 0 end, status::expense_status from perf_e`);
  await exec(sql`insert into journal_entries (id, tenant_id, entry_date, source_type, source_id, created_by) select id, ${t}::uuid, dt, 'expense', id, ${u}::uuid from perf_e`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${expenseAcct.id}::uuid, total, 0 from perf_e`);
  await exec(sql`insert into journal_lines (journal_entry_id, account_id, debit_amount, credit_amount) select id, ${ap}::uuid, 0, total from perf_e`);

  await exec(sql`analyze`);
}

async function counts() {
  const t = org.tenantId;
  const one = async (query: string) => {
    const res = (await db.execute(sql.raw(query))) as unknown as { rows?: { c: string }[] } | { c: string }[];
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    return Number(rows[0]?.c ?? 0);
  };
  const q = (table: string) => one(`select count(*) c from ${table} where tenant_id = '${t}'`);
  const lines = await one(`select count(*) c from journal_lines l join journal_entries e on e.id = l.journal_entry_id where e.tenant_id = '${t}'`);
  return { invoices: await q("sales_invoices"), bills: await q("purchase_bills"), expenses: await q("expenses"), payments: await q("payments_ledger"), entries: await q("journal_entries"), lines };
}

async function cleanup() {
  await dropScratch();
  const t = org.tenantId;
  await exec(sql`delete from payments_ledger where tenant_id = ${t}::uuid`);
  await exec(sql`delete from journal_lines where journal_entry_id in (select id from journal_entries where tenant_id = ${t}::uuid)`);
  await exec(sql`delete from journal_entries where tenant_id = ${t}::uuid`);
  await db.delete(tenants).where(eq(tenants.id, t));
}

describe.skipIf(!enabled)("the dashboard on a large organization", () => {
  beforeAll(async () => {
    org = await createTempOrg("ZZ Scale");
    const start = t0();
    await build();
    out(`built in ${Math.round((performance.now() - start) / 1000)}s ${JSON.stringify(await counts())}`);
  }, 900_000);

  afterAll(async () => {
    out(["", "figure | wall ms | queries | ms without travel", ...timings.map((x) => `${x.name} | ${x.ms} | ${x.queries} | ${x.withoutTravel}`), ""].join("\n"));
    await cleanup();
  }, 900_000);

  it("answers every dashboard figure quickly", async () => {
    const t = org.tenantId;
    const probe = performance.now();
    for (let i = 0; i < 5; i++) await db.execute(sql`select 1`);
    roundTrip = (performance.now() - probe) / 5;
    out(`one round trip to the database: ${Math.round(roundTrip)} ms`);
    const yearAgo = new Date(Date.parse(today + "T00:00:00Z") - 365 * 86_400_000).toISOString().slice(0, 10);
    for (const round of [1]) {
      const tag = round === 1 ? "first" : "again";
      await timed(`overview: kpis (${tag})`, () => dashboardKpis(t, { from: yearAgo, to: today }));
      await timed(`overview: cash today (${tag})`, () => cashAndBankBreakdown(t, today));
      await timed(`overview: needs attention (${tag})`, () => needsAttention(t, today));
      await timed(`cash flow, one year (${tag})`, () => cashFlow(t, yearAgo, today));
      await timed(`cash flow, one month (${tag})`, () => cashFlow(t, new Date(Date.parse(today + "T00:00:00Z") - 29 * 86_400_000).toISOString().slice(0, 10), today));
      await timed(`upcoming: summary (${tag})`, () => upcomingSummary(t, today));
      await timed(`upcoming: customers (${tag})`, () => upcomingParties(t, today, "coming", null));
      await timed(`upcoming: suppliers (${tag})`, () => upcomingParties(t, today, "going", null));
      await timed(`forecast, 30 days (${tag})`, () => loadForecast(t, today, 30));
      await timed(`forecast, 90 days (${tag})`, () => loadForecast(t, today, 90));
      await timed(`planning, 90 days (${tag})`, () => loadPlanning(t, today, 90));
      await timed(`cash cycle (${tag})`, () => loadCashCycle(t, today));
    }
    if (process.env.PERF_EXPLAIN) {
      // The slowest statements again, with the database's own account of where the time went.
      for (const q of [...slowQueries].sort((a, b) => b.ms - a.ms).slice(0, 8)) {
        if (!/^s*select/i.test(q.text)) continue;
        try {
          const plan = (await unsafe(`explain (analyze, buffers) ${q.text}`, q.params as never)) as unknown as Record<string, string>[];
          out(`---- ${q.ms} ms`);
          out(q.text.slice(0, 700));
          out(plan.map((r) => r["QUERY PLAN"]).join(String.fromCharCode(10)));
        } catch (e) {
          out(`---- could not explain: ${(e as Error).message}`);
        }
      }
    }
    const slowest = Math.max(...timings.map((x) => x.withoutTravel));
    // With the travel taken off, every figure is worked out inside a couple of seconds even with about 100,000 documents.
    expect(slowest).toBeLessThan(2500);
  }, 600_000);
});
