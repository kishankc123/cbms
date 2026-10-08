// Employee IDs are generated: EMP-0001, EMP-0002, ... Pure: no database.

export const EMPLOYEE_CODE_PREFIX = "EMP-";

/** The next free ID: one more than the highest EMP-number in use (a gap left by a removed employee is never reused), skipping any code taken. */
export function nextEmployeeCode(existing: Iterable<string>): string {
  const taken = new Set(existing);
  let highest = 0;
  for (const code of taken) {
    const m = /^EMP-(\d+)$/.exec(code);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  let n = highest + 1;
  let code = format(n);
  while (taken.has(code)) code = format(++n);
  return code;
}

const format = (n: number) => `${EMPLOYEE_CODE_PREFIX}${String(n).padStart(4, "0")}`;
