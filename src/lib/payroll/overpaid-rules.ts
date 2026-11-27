// How much an employee has been overpaid, worked out from their one staff account (no database).

const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * `balance` is the staff account: positive means the company owes the employee, negative that the employee owes the company. `pendingAdvances` are advances still
 * waiting for their payroll month: money owed back that payroll will take in its turn, so it is not an overpayment.
 */
export function overpaidOf(balance: number, pendingAdvances: number): number {
  return Math.max(round2(-balance - pendingAdvances), 0);
}

/**
 * What a payslip takes off for money already paid that no advance record covers (an earlier salary payment above what was owed, or salary paid before the run was
 * finalized). `balanceBefore` and `outstandingAdvances` are as they stand without this run; advances are left out because payroll recovers them on its own line.
 */
export function overpaidAdjustment(balanceBefore: number, outstandingAdvances: number, netPay: number): number {
  return Math.min(overpaidOf(balanceBefore, outstandingAdvances), Math.max(round2(netPay), 0));
}
