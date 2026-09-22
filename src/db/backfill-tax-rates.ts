// One-time migration: before this, VAT/TDS rates were one current value per organization (tenants.vatRate /
// tenants.tdsRate), so a backdated transaction was always taxed at TODAY's rate instead of the rate that actually
// applied on its date. This seeds each organization's existing rate as an open-ended row starting from an early
// date, so every transaction ever posted still finds the same rate it always would have (nothing changes for
// existing data) — but from here on, a rate change closes that row and starts a new one, and lookups are by date.
//
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/backfill-tax-rates.ts          (dry run)
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs src/db/backfill-tax-rates.ts --apply
//
// Idempotent: a tenant/tax type that already has a rate row is left alone.
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { memberships, taxRates, tenants } from "./schema";

const apply = process.argv.includes("--apply");
// Before this date is earlier than any organization in this system could have transactions.
const EARLIEST = "2000-01-01";

async function main() {
  let seeded = 0;
  for (const tenant of await db.select().from(tenants)) {
    const [owner] = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.tenantId, tenant.id)).limit(1);
    if (!owner) continue;

    for (const { taxTypeKey, rate } of [
      { taxTypeKey: "vat" as const, rate: tenant.vatRate },
      { taxTypeKey: "tds" as const, rate: tenant.tdsRate },
    ]) {
      const [existing] = await db.select({ id: taxRates.id }).from(taxRates).where(and(eq(taxRates.tenantId, tenant.id), eq(taxRates.taxTypeKey, taxTypeKey))).limit(1);
      if (existing) continue;
      seeded++;
      console.log(`${apply ? "SEEDING" : "WOULD SEED"} ${tenant.id} ${taxTypeKey} = ${rate}% from ${EARLIEST}`);
      if (apply) {
        await db.insert(taxRates).values({ tenantId: tenant.id, taxTypeKey, rate, effectiveFrom: EARLIEST, createdBy: owner.userId });
      }
    }
  }
  console.log(seeded === 0 ? "Nothing to seed." : apply ? "Done." : `${seeded} row(s) to seed — re-run with --apply.`);
  process.exit(0);
}
main();
