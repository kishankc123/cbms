import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, customers, employees, vendors, journalEntries, journalLines } from "@/db/schema";
import { findControlAccount, createSubAccount } from "./control-accounts";

// Money received from a customer before an invoice exists, or the
// unallocated remainder of a customer payment that overshoots their
// outstanding invoices — a liability until applied to a real invoice.
export async function getOrCreateCustomerAdvanceAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["2350"], "Customer Advance");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "2350", name: "Customer Advance", category: "liability", subCategory: "Current liabilities" })
    .returning();
  return created;
}

async function getOrCreateSubAccountId(
  tenantId: string,
  parent: { id: string; code: string; category: (typeof accounts.$inferSelect)["category"]; subCategory: string | null },
  name: string
) {
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, parent.id), eq(accounts.name, name)))
    .limit(1);
  if (existing) return existing.id;
  const created = await createSubAccount(tenantId, parent, name);
  return created.id;
}

export async function getOrCreateCustomerAdvanceSubAccountId(tenantId: string, customerName: string) {
  const parent = await getOrCreateCustomerAdvanceAccount(tenantId);
  return getOrCreateSubAccountId(tenantId, parent, customerName);
}

// Money paid to a supplier before their purchase/bill exists — an asset
// (prepayment) until applied to a real bill.
export async function getOrCreateSupplierAdvanceAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["1350"], "Supplier Advance");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "1350", name: "Supplier Advance", category: "asset", subCategory: "Current assets" })
    .returning();
  return created;
}

export async function getOrCreateSupplierAdvanceSubAccountId(tenantId: string, supplierName: string) {
  const parent = await getOrCreateSupplierAdvanceAccount(tenantId);
  return getOrCreateSubAccountId(tenantId, parent, supplierName);
}

export async function getOrCreateOwnerDrawingsAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["3050"], "Owner's Drawings");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "3050", name: "Owner's Drawings", category: "equity" })
    .returning();
  return created;
}

// ---- per-party advance accounts, linked by the party's id (never by name)

/** The net of every line posted to an account, debits minus credits. Reversals cancel, so no filtering is needed. */
async function debitMinusCredit(tenantId: string, accountId: string): Promise<number> {
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${journalLines.debitAmount} - ${journalLines.creditAmount}), 0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.journalEntryId))
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, accountId)));
  return Math.round(Number(row.v) * 100) / 100 + 0; // "+ 0" turns a negative zero into 0
}

/**
 * The customer's own advance sub-account, created (and linked to them) on first use. An advance account that an older
 * version created under the customer's NAME is adopted when exactly one customer carries that name.
 */
export async function getOrCreateCustomerAdvanceAccountId(tenantId: string, customerId: string): Promise<string> {
  const [c] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
  if (!c) throw new Error("Customer not found");
  if (c.advanceAccountId) return c.advanceAccountId;

  const parent = await getOrCreateCustomerAdvanceAccount(tenantId);
  const sameName = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.name, c.name)));
  const [legacy] = sameName.length === 1 ? await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, parent.id), eq(accounts.name, c.name))).limit(1) : [];
  const id = legacy ? legacy.id : (await createSubAccount(tenantId, parent, c.name)).id;
  await db.update(customers).set({ advanceAccountId: id }).where(eq(customers.id, customerId));
  return id;
}

export async function getOrCreateSupplierAdvanceAccountId(tenantId: string, vendorId: string): Promise<string> {
  const [v] = await db.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  if (!v) throw new Error("Supplier not found");
  if (v.advanceAccountId) return v.advanceAccountId;

  const parent = await getOrCreateSupplierAdvanceAccount(tenantId);
  const sameName = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.tenantId, tenantId), eq(vendors.name, v.name)));
  const [legacy] = sameName.length === 1 ? await db.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.parentAccountId, parent.id), eq(accounts.name, v.name))).limit(1) : [];
  const id = legacy ? legacy.id : (await createSubAccount(tenantId, parent, v.name)).id;
  await db.update(vendors).set({ advanceAccountId: id }).where(eq(vendors.id, vendorId));
  return id;
}

/** What a customer has paid in advance and not yet had applied or refunded (a liability: credit-normal). */
export async function getCustomerAdvanceBalance(tenantId: string, customerId: string): Promise<number> {
  const [c] = await db.select({ a: customers.advanceAccountId }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
  if (!c?.a) return 0;
  return 0 - (await debitMinusCredit(tenantId, c.a));
}

/** What we have paid a supplier in advance and not yet had applied or refunded (an asset: debit-normal). */
export async function getSupplierAdvanceBalance(tenantId: string, vendorId: string): Promise<number> {
  const [v] = await db.select({ a: vendors.advanceAccountId }).from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId))).limit(1);
  if (!v?.a) return 0;
  return await debitMinusCredit(tenantId, v.a);
}

// ---- staff advances: money paid to an employee ahead of salary (an asset until recovered from their pay)

export async function getOrCreateStaffAdvanceAccount(tenantId: string) {
  const existing = await findControlAccount(tenantId, ["1360"], "Staff Advances");
  if (existing) return existing;
  const [created] = await db
    .insert(accounts)
    .values({ tenantId, code: "1360", name: "Staff Advances", category: "asset", subCategory: "Current assets" })
    .returning();
  return created;
}

/** The employee's own Staff Advances sub-account, created (and linked to them by id) on first use. */
export async function getOrCreateEmployeeAdvanceAccountId(tenantId: string, employeeId: string): Promise<string> {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId))).limit(1);
  if (!e) throw new Error("Employee not found");
  if (e.advanceAccountId) return e.advanceAccountId;
  const parent = await getOrCreateStaffAdvanceAccount(tenantId);
  const id = (await createSubAccount(tenantId, parent, e.fullName)).id;
  await db.update(employees).set({ advanceAccountId: id }).where(eq(employees.id, employeeId));
  return id;
}

/** What we have advanced an employee and not yet recovered (an asset: debit-normal), from the ledger. */
export async function getEmployeeAdvanceBalance(tenantId: string, employeeId: string): Promise<number> {
  const [e] = await db.select({ a: employees.advanceAccountId }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenantId))).limit(1);
  if (!e?.a) return 0;
  return await debitMinusCredit(tenantId, e.a);
}
