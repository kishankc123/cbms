// One-time (and safely re-runnable) step for the move to ledger-based settlement of invoices and bills:
//   1. moves whatever is still on customers' and suppliers' old Advance accounts onto their own ledger account,
//   2. settles every customer's invoices and every supplier's bills from their ledger (what was paid with a document, or allocated
//      to it by hand, stays with it; the rest goes to the oldest open documents first).
// Run it once per database after deploying (set DATABASE_URL to the right database first):
//   npm run ledger:settle -- --report     only lists what would change, writes nothing
//   npm run ledger:settle                 does it
import { and, asc, eq } from "drizzle-orm";
import { db } from "./index";
import { memberships, tenants } from "./schema";
import { settleAllFromLedger } from "../lib/ledger/legacy-advances";

async function main() {
  const report = process.argv.includes("--report");
  for (const t of await db.select({ id: tenants.id, name: tenants.companyName }).from(tenants)) {
    const [owner] = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, t.id), eq(memberships.role, "owner"))).orderBy(asc(memberships.createdAt)).limit(1);
    if (!owner) {
      console.log(`${t.name}: no owner, skipped`);
      continue;
    }
    const r = await settleAllFromLedger(t.id, report ? null : owner.userId);
    console.log(`${t.name}: ${r.customers} customers, ${r.suppliers} suppliers; ${r.moved.toFixed(2)} ${report ? "would move" : "moved"} off the old Advance accounts${report ? `; ${r.changes.length} document(s) would change` : ""}`);
    for (const c of r.changes) console.log(`    ${c.party} — ${c.number}: paid ${Number(c.before).toFixed(2)} -> ${Number(c.after).toFixed(2)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
