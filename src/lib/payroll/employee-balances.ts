import { staffBalances } from "./staff-account";

/** Every employee's staff account balance, for the list: positive means the company owes the employee, negative that the employee owes the company. */
export async function employeeBalances(tenantId: string): Promise<Record<string, number>> {
  return Object.fromEntries(await staffBalances(tenantId));
}
