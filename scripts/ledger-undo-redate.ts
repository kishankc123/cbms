// Puts back the dates changed by ledger-redate-reversals.ts, using the audit log. Preview by default; --apply to change. Optional: --company "part of the name" (or --tenant <id>) to limit it to one organization.
//   node node_modules/tsx/dist/cli.mjs scripts/ledger-undo-redate.ts            (preview)
//   node node_modules/tsx/dist/cli.mjs scripts/ledger-undo-redate.ts --apply    (do it)
import { db } from "../src/db";
import { tenants } from "../src/db/schema";
import { ilike } from "drizzle-orm";
import { undoRedatedReversals } from "../src/lib/ledger/undo-redate";

async function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--tenant");
  let tenantId = at >= 0 ? process.argv[at + 1] : undefined;
  // --company "part of the name" picks one organization by name instead of by id
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
  const report = await undoRedatedReversals({ tenantId, apply });
  const names = new Map((await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants)).map((t) => [t.id, t.name]));
  const line = (i: { tenantId: string; from: string; to: string; reference: string | null }) => `${names.get(i.tenantId) ?? i.tenantId} | ${i.reference ?? "-"} | ${i.from} -> ${i.to}`;
  console.log(`${apply ? "RESTORED" : "WOULD RESTORE"} ${report.restored.length}:`);
  report.restored.forEach((m) => console.log("  " + line(m)));
  console.log(`LEFT AS THEY ARE ${report.skipped.length}:`);
  report.skipped.forEach((s) => console.log("  " + line(s) + " | " + s.reason));
  if (!apply && report.restored.length) console.log("\nRun again with --apply to make these changes.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
