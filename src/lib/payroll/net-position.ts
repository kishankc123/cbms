const round2 = (n: number) => Math.round(n * 100) / 100;

export type NetPosition = {
  /** Salary the company owes the employee (the employee's Salary Payable account). */
  salaryOwed: number;
  /** Advances paid to the employee and not yet recovered (the employee's Staff Advance account). */
  advanceHeld: number;
  /** Salary owed minus advances held, always shown as a positive amount with the side it is on. */
  amount: number;
  side: "company_owes" | "employee_owes" | "even";
};

/**
 * The two accounts of an employee set against each other: what the company owes them in salary, less what they hold in advances. Positive: the company still
 * owes the employee that much after the advance is taken off. Negative: the employee holds more advance than salary owed. Nothing is posted; this is a view.
 */
export function netPosition(salaryOwed: number, advanceHeld: number): NetPosition {
  const owed = round2(salaryOwed);
  const held = round2(advanceHeld);
  const net = round2(owed - held);
  return { salaryOwed: owed, advanceHeld: held, amount: Math.abs(net), side: net > 0 ? "company_owes" : net < 0 ? "employee_owes" : "even" };
}
