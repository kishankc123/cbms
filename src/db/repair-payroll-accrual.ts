// One-time repair: a payroll run could be marked finalized without its ledger entry being posted (the old
// finalize step posted after the status change and ignored a failed post). This posts the missing salary
// entry for every finalized run that has none in force, dated the run's period end like a normal finalize.
//
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/repair-payroll-accrual.ts          (dry run)
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/repair-payroll-accrual.ts --apply
//
// Idempotent: a run that already has an active entry is skipped.
import { eq } from "drizzle-orm";
import { db } from "./index";
import { payrollRuns, tenants } from "./schema";
import { activePayrollEntries, postPayrollAccrual } from "../lib/payroll/accrual";

const apply = process.argv.includes("--apply");

async function main() {
  const all = await db.select().from(tenants);
  let missing = 0;
  for (const tenant of all) {
    const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, tenant.id));
    for (const run of runs.filter((r) => r.status === "finalized")) {
      if ((await activePayrollEntries(tenant.id, run.id)).length > 0) continue;
      missing++;
      const label = `${tenant.id}: run ${run.calendarSystem === "BS" ? "BS " : ""}${run.year}-${String(run.month).padStart(2, "0")} (${run.periodStart} to ${run.periodEnd})`;
      if (!apply) {
        console.log(`WOULD POST ${label}`);
        continue;
      }
      try {
        const id = await postPayrollAccrual(tenant.id, run, run.createdBy);
        console.log(`POSTED ${label} -> entry ${id}`);
      } catch (e) {
        console.log(`FAILED ${label}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  console.log(missing === 0 ? "Nothing to repair." : apply ? "Done." : `${missing} run(s) need repair — re-run with --apply.`);
  process.exit(0);
}
main();
