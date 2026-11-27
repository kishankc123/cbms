// Moves each employee's old Staff Advances history onto their one staff account (see lib/payroll/merge-staff-accounts.ts). Run it once per database, on a copy
// of the data first. Set DATABASE_URL to the database you mean: the script prints which one it is talking to.
//   npm run staff:merge                 preview only: lists what would move, writes nothing
//   npm run staff:merge -- --apply      does it
//   npm run staff:merge -- --undo       puts the moved lines back
// Add --org=<organization id> to work on one organization only.
import { db } from "./index";
import { tenants } from "./schema";
import { mergeStaffAccounts, planStaffAccountMerge, undoStaffAccountMerge } from "../lib/payroll/merge-staff-accounts";

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const balance = (n: number) => (Math.abs(n) < 0.005 ? "0.00" : n > 0 ? `we owe ${money(n)}` : `owes us ${money(-n)}`);

async function main() {
  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  const only = process.argv.find((a) => a.startsWith("--org="))?.slice("--org=".length);
  const at = new URL(process.env.DATABASE_URL!);
  console.log(`Database: ${at.host}${at.pathname}`);
  console.log(undo ? "UNDOING the move\n" : apply ? "MOVING the history\n" : "Preview only. Nothing is written.\n");

  let failed = 0;
  for (const t of await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants)) {
    if (only && t.id !== only) continue;
    try {
      if (undo) {
        const n = await undoStaffAccountMerge(t.id);
        if (n > 0) console.log(`${t.name}: ${n} lines put back`);
        continue;
      }
      const plan = apply ? await mergeStaffAccounts(t.id) : await planStaffAccountMerge(t.id);
      if (plan.rows.length === 0 && plan.leftOver.length === 0) continue;
      console.log(`${t.name}: ${plan.rows.length} employee(s), ${plan.lines} line(s) ${apply ? "moved" : "to move"}`);
      for (const r of plan.rows) console.log(`    ${r.code} ${r.name}: salary account ${balance(r.salaryAccount)} | advance account ${balance(r.advanceAccount)} | one account ${balance(r.combined)}`);
      console.log(`    Total assets and total liabilities both fall by ${money(plan.totalsFallBy)}. Profit does not change.`);
      for (const l of plan.leftOver) console.log(`    LEFT WHERE IT IS (belongs to no employee): ${l.code} ${l.name} ${money(-l.net)}`);
    } catch (e) {
      failed += 1;
      console.error(`${t.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
