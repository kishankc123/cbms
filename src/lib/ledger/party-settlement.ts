import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, vendors } from "@/db/schema";

// What an invoice or bill shows as paid is not recorded document by document. Money received or paid, credit notes and any advance
// all sit on the customer's or supplier's OWN ledger account, and the ledger is the truth. Their documents are settled from it:
//   - what was paid together with a document (the payment recorded with the invoice or bill, and any payment an earlier version
//     allocated to it by hand) stays with that document;
//   - whatever else the ledger says has been cleared, beyond what the party still owes, is spread over the documents that are
//     still open, oldest first, until it runs out.
// Call this after anything that changes a party's ledger or documents (a payment, a void, an invoice, a return). One statement;
// only documents whose figure changed are written.

export type PartySide = "customer" | "supplier";

const DOCS = {
  customer: { table: sql.raw("sales_invoices"), party: sql.raw("customer_id"), date: sql.raw("invoice_date"), number: sql.raw("invoice_number"), target: "sales_invoice", unpaid: sql.raw("'sent'::invoice_status"), paid: sql.raw("'paid'::invoice_status"), part: sql.raw("'partially_paid'::invoice_status"), skip: sql.raw("'void'::invoice_status, 'draft'::invoice_status"), owed: sql.raw("l.debit_amount - l.credit_amount") },
  supplier: { table: sql.raw("purchase_bills"), party: sql.raw("vendor_id"), date: sql.raw("bill_date"), number: sql.raw("bill_number"), target: "purchase_bill", unpaid: sql.raw("'open'::bill_status"), paid: sql.raw("'paid'::bill_status"), part: sql.raw("'partially_paid'::bill_status"), skip: sql.raw("'void'::bill_status, 'draft'::bill_status"), owed: sql.raw("l.credit_amount - l.debit_amount") },
};

/** After a posting that names accounts but not parties (a manual journal entry, a reversal): settle whoever owns those accounts. */
export async function resettleForAccounts(tenantId: string, accountIds: string[]) {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return;
  const [cs, vs] = await Promise.all([
    db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), inArray(customers.receivableAccountId, ids))),
    db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.tenantId, tenantId), inArray(vendors.payableAccountId, ids))),
  ]);
  for (const c of cs) await resettleParty(tenantId, "customer", c.id);
  for (const v of vs) await resettleParty(tenantId, "supplier", v.id);
}

export type SettlementChange = { number: string; before: string; after: string };

/** Settles a party's documents from their ledger, or (preview) only reports which documents would change. */
async function settle(tenantId: string, side: PartySide, partyId: string, preview: boolean): Promise<SettlementChange[]> {
  const [party] =
    side === "customer"
      ? await db.select({ account: customers.receivableAccountId }).from(customers).where(and(eq(customers.id, partyId), eq(customers.tenantId, tenantId))).limit(1)
      : await db.select({ account: vendors.payableAccountId }).from(vendors).where(and(eq(vendors.id, partyId), eq(vendors.tenantId, tenantId))).limit(1);
  if (!party?.account) return []; // a party with no ledger account of its own has nothing to settle against

  const d = DOCS[side];
  const status = sql`case when c.paid >= c.total - 0.005 then ${d.paid} when c.paid > 0 then ${d.part} else ${d.unpaid} end`;
  const changed = sql`(t.amount_paid <> c.paid or t.status <> ${status})`;
  const settled = sql`
    with own as (
      select a.target_id as id, sum(a.allocated_amount) as amount
      from payment_allocations a join payments_ledger p on p.id = a.payment_id
      where p.tenant_id = ${tenantId} and p.status <> 'voided' and a.target_type = ${d.target}
      group by a.target_id
    ),
    docs as (
      select t.id, t.total, least(t.total, coalesce(o.amount, 0)) as own,
        coalesce(sum(t.total - least(t.total, coalesce(o.amount, 0))) over (order by t.${d.date}, t.${d.number}, t.id rows between unbounded preceding and 1 preceding), 0) as before
      from ${d.table} t left join own o on o.id = t.id
      where t.tenant_id = ${tenantId} and t.${d.party} = ${partyId} and t.status not in (${d.skip})
    ),
    owed as (
      select coalesce(sum(${d.owed}), 0) as net
      from journal_lines l join journal_entries e on e.id = l.journal_entry_id
      where e.tenant_id = ${tenantId} and l.account_id = ${party.account}
    ),
    cleared as (
      select greatest(coalesce((select sum(total) from docs), 0) - (select net from owed) - coalesce((select sum(own) from docs), 0), 0) as amount
    ),
    c as (
      select id, total, own + least(total - own, greatest((select amount from cleared) - before, 0)) as paid from docs
    )`;
  if (!preview) {
    await db.execute(sql`${settled} update ${d.table} t set amount_paid = c.paid, status = ${status} from c where t.id = c.id and ${changed}`);
    return [];
  }
  const rows = await db.execute<SettlementChange>(sql`${settled} select t.${d.number} as number, t.amount_paid as before, c.paid as after from c join ${d.table} t on t.id = c.id where ${changed}`);
  return [...rows];
}

export async function resettleParty(tenantId: string, side: PartySide, partyId: string | null | undefined) {
  if (partyId) await settle(tenantId, side, partyId, false);
}

/** Which documents settling would change for a party, and how, without changing anything (the report-only run of ledger:settle). */
export async function previewSettlement(tenantId: string, side: PartySide, partyId: string) {
  return settle(tenantId, side, partyId, true);
}
