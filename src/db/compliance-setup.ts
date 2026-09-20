// One-time / re-runnable setup for the compliance framework:
//   1. loads the shipped country configuration (insert-only: keeps platform edits),
//   2. for every organization: adopts its tax payable accounts into the
//      "Taxes Payable" group, migrates its old calendar items, and generates
//      the obligations its country / entity type / registrations call for.
// Everything is idempotent and non-destructive.
import { db } from "./index";
import { tenants } from "./schema";
import { syncComplianceConfig } from "../lib/compliance/config/sync";
import { ensureTaxPayableStructure } from "../lib/compliance/tax-accounts";
import { migrateLegacyCalendarItems } from "../lib/compliance/engine/legacy-migration";
import { generateObligations } from "../lib/compliance/engine/generate";

async function main() {
  await syncComplianceConfig();
  console.log("Country configuration loaded.");

  const all = await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants);
  for (const t of all) {
    await ensureTaxPayableStructure(t.id);
    const migration = await migrateLegacyCalendarItems(t.id);
    const generated = await generateObligations(t.id);
    console.log(`${t.name}: legacy migrated ${migration.migrated}, merged ${migration.merged}, skipped ${migration.skipped}; generated ${generated}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
