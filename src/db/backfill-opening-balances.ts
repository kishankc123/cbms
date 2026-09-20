// One-off backfill for tenants that predate the customer/supplier/employee
// sub-ledger linkage:
//   - creates each customer's Accounts Receivable sub-account and each
//     supplier's Accounts Payable sub-account (if missing)
//   - re-syncs opening balance entries so they route through those
//     sub-accounts instead of the shared 1100/2000 control accounts
//   - links each employee's Salary Payable sub-account (if missing)
// Safe to re-run — getOrCreate* is a no-op once linked, and syncing an
// opening balance always reverses whatever was posted before first.
import { eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { customers, vendors, employees } from "./schema";
import { listOrgUsers } from "../lib/org-users";
import { createCustomerReceivableAccount, createSupplierPayableAccount } from "../lib/ledger/subledger-accounts";
import { syncCustomerOpeningBalanceEntry, syncSupplierOpeningBalanceEntry } from "../lib/ledger/opening-balance";
import { createEmployeePayableAccount } from "../lib/ledger/payroll-accounts";

async function main() {
  let customersLinked = 0;
  let customerBalancesSynced = 0;

  const allCustomers = await db.select().from(customers);
  for (const customer of allCustomers) {
    let receivableAccountId = customer.receivableAccountId;
    if (!receivableAccountId) {
      const account = await createCustomerReceivableAccount(customer.tenantId, customer.name);
      receivableAccountId = account.id;
      await db.update(customers).set({ receivableAccountId }).where(eq(customers.id, customer.id));
      customersLinked++;
      console.log(`Linked Accounts Receivable sub-account for customer ${customer.name}`);
    }

    const openingBalance = Number(customer.openingBalance);
    if (openingBalance === 0) continue;
    const [systemUser] = await listOrgUsers(customer.tenantId);
    if (!systemUser) continue;

    await syncCustomerOpeningBalanceEntry(customer.tenantId, customer.id, customer.name, openingBalance, systemUser.id);
    customerBalancesSynced++;
    console.log(`Synced opening balance for customer ${customer.name}: ${openingBalance}`);
  }

  let suppliersLinked = 0;
  let supplierBalancesSynced = 0;

  const allVendors = await db.select().from(vendors);
  for (const vendor of allVendors) {
    let payableAccountId = vendor.payableAccountId;
    if (!payableAccountId) {
      const account = await createSupplierPayableAccount(vendor.tenantId, vendor.name);
      payableAccountId = account.id;
      await db.update(vendors).set({ payableAccountId }).where(eq(vendors.id, vendor.id));
      suppliersLinked++;
      console.log(`Linked Accounts Payable sub-account for supplier ${vendor.name}`);
    }

    const openingBalance = Number(vendor.openingBalance);
    if (openingBalance === 0) continue;
    const [systemUser] = await listOrgUsers(vendor.tenantId);
    if (!systemUser) continue;

    await syncSupplierOpeningBalanceEntry(vendor.tenantId, vendor.id, vendor.name, openingBalance, systemUser.id);
    supplierBalancesSynced++;
    console.log(`Synced opening balance for supplier ${vendor.name}: ${openingBalance}`);
  }

  let employeesLinked = 0;
  const unlinkedEmployees = await db.select().from(employees).where(isNull(employees.payableAccountId));
  for (const employee of unlinkedEmployees) {
    const account = await createEmployeePayableAccount(employee.tenantId, employee.fullName);
    await db.update(employees).set({ payableAccountId: account.id }).where(eq(employees.id, employee.id));
    employeesLinked++;
    console.log(`Linked Salary Payable sub-account for employee ${employee.fullName}`);
  }

  console.log(
    `Done. Linked ${customersLinked} customer / ${suppliersLinked} supplier / ${employeesLinked} employee sub-accounts. Synced ${customerBalancesSynced} customer / ${supplierBalancesSynced} supplier opening balances.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
