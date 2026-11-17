// Moves the unpaid part of expenses that have a supplier from the shared Expense Payable account to the supplier's own account, so it shows in the
// supplier's history, statement and ageing. Prints what it would do and changes nothing, unless run with --apply.
// Optional: --company "part of the name" (or --tenant <id>) to limit it to one organization.
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/move-expense-payables.ts            (preview)
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/move-expense-payables.ts --apply    (do it)
import { db } from "../src/db";
import { tenants } from "../src/db/schema";
import { ilike } from "drizzle-orm";
import { moveExpensePayables } from "../src/lib/expenses/move-payables";

async function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--tenant");
  let tenantId = at >= 0 ? process.argv[at + 1] : undefined;
  const cn = process.argv.indexOf("--company");
  if (cn >= 0) {
    const found = await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants).where(ilike(tenants.companyName, `%${process.argv[cn + 1]}%`));
    if (found.length !== 1) {
      console.log(found.length === 0 ? "No organization has that in its name." : "More than one organization matches. Use more of the name:");
      found.forEach((f) => console.log("  " + f.name));
      process.exit(1);
    }
    console.log("Organization: " + found[0].name);
    tenantId = found[0].id;
  }
  const report = await moveExpensePayables({ tenantId, apply });
  const names = new Map((await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants)).map((t) => [t.id, t.name]));
  const line = (i: { tenantId: string; number: string; supplier: string; date: string; unpaid: number }) => `${names.get(i.tenantId) ?? i.tenantId} | ${i.number} | ${i.date} | ${i.supplier} | unpaid ${i.unpaid.toFixed(2)}`;
  console.log(`${apply ? "MOVED" : "WOULD MOVE"} ${report.moved.length}:`);
  report.moved.forEach((m) => console.log("  " + line(m)));
  console.log(`LEFT AS THEY ARE ${report.skipped.length}:`);
  report.skipped.forEach((s) => console.log(`  ${line(s)} | ${s.reason}`));
  if (!apply && report.moved.length > 0) console.log("\nNothing was changed. Run again with --apply to do it.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
