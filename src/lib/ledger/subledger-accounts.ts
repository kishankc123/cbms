import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, vendors } from "@/db/schema";
import { findControlAccount, createSubAccount } from "./control-accounts";

// Creates a customer's own sub-account nested under Accounts Receivable —
// every sale, receipt, and opening balance for this customer posts here
// instead of the shared 1100 control account.
export async function createCustomerReceivableAccount(tenantId: string, customerName: string) {
  const ar = await findControlAccount(tenantId, ["1100"], "Accounts Receivable");
  if (!ar) throw new Error("No Accounts Receivable account found — add one to the Chart of Accounts first");
  return createSubAccount(tenantId, ar, customerName);
}

// Creates a supplier's own sub-account nested under Accounts Payable —
// every purchase, payment, and opening balance for this supplier posts here
// instead of the shared 2000 control account.
export async function createSupplierPayableAccount(tenantId: string, supplierName: string) {
  const ap = await findControlAccount(tenantId, ["2000"], "Accounts Payable");
  if (!ap) throw new Error("No Accounts Payable account found — add one to the Chart of Accounts first");
  return createSubAccount(tenantId, ap, supplierName);
}

// Returns the customer's receivable sub-account id, creating (and
// persisting) it on first use — covers customers created before this
// linkage existed, so every caller can rely on it always resolving.
export async function getOrCreateCustomerReceivableAccountId(tenantId: string, customerId: string): Promise<string> {
  const [customer] = await db
    .select({ receivableAccountId: customers.receivableAccountId, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  if (!customer) throw new Error("Customer not found");
  if (customer.receivableAccountId) return customer.receivableAccountId;

  const account = await createCustomerReceivableAccount(tenantId, customer.name);
  await db.update(customers).set({ receivableAccountId: account.id }).where(eq(customers.id, customerId));
  return account.id;
}

// Returns the supplier's payable sub-account id, creating (and persisting)
// it on first use — covers suppliers created before this linkage existed.
export async function getOrCreateSupplierPayableAccountId(tenantId: string, supplierId: string): Promise<string> {
  const [supplier] = await db
    .select({ payableAccountId: vendors.payableAccountId, name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.id, supplierId), eq(vendors.tenantId, tenantId)))
    .limit(1);
  if (!supplier) throw new Error("Supplier not found");
  if (supplier.payableAccountId) return supplier.payableAccountId;

  const account = await createSupplierPayableAccount(tenantId, supplier.name);
  await db.update(vendors).set({ payableAccountId: account.id }).where(eq(vendors.id, supplierId));
  return account.id;
}
