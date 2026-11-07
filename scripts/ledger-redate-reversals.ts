// Moves the undo entries made the old way (dated the day of the edit or void) to the date of the entry they undo.
// Prints what it would do and changes nothing, unless run with --apply. Optional: --tenant <id> to limit it to one organization.
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/ledger-redate-reversals.ts            (preview)
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/ledger-redate-reversals.ts --apply    (do it)
import { db } from "../src/db";
import { tenants } from "../src/db/schema";
import { redateReversals } from "../src/lib/ledger/redate-reversals";

async function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--tenant");
  const tenantId = at >= 0 ? process.argv[at + 1] : undefined;
  const report = await redateReversals({ tenantId, apply });
  const names = new Map((await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants)).map((t) => [t.id, t.name]));
  const line = (i: { tenantId: string; from: string; to: string; reference: string | null; memo: string | null }) => `${names.get(i.tenantId) ?? i.tenantId} | ${i.reference ?? "-"} | ${i.from} -> ${i.to} | ${(i.memo ?? "").slice(0, 50)}`;
  console.log(`${apply ? "MOVED" : "WOULD MOVE"} ${report.moved.length}:`);
  report.moved.forEach((m) => console.log("  " + line(m)));
  console.log(`LEFT AS THEY ARE ${report.skipped.length}:`);
  report.skipped.forEach((s) => console.log("  " + line(s) + " | " + s.reason));
  if (!apply && report.moved.length) console.log("\nRun again with --apply to make these changes.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
