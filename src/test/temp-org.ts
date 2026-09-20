import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines, memberships, tenants, capitalChanges } from "@/db/schema";
import { createOrganization } from "@/lib/organizations";

/**
 * A throwaway organization for integration tests, with a real owner user borrowed from
 * the database. `remove()` deletes everything the test created (journal lines first,
 * because the ledger deliberately has no cascade from accounts).
 */
export async function createTempOrg(name = "ZZ Integration Test") {
  const [m] = await db.select().from(memberships).limit(1);
  if (!m) throw new Error("Integration tests need at least one user in the database");
  const tenant = await createOrganization({ name: `${name} ${Date.now()}`, panNumber: "999888777" }, m.userId);
  return {
    tenantId: tenant.id,
    userId: m.userId,
    async remove() {
      const entries = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenant.id));
      if (entries.length) await db.delete(journalLines).where(inArray(journalLines.journalEntryId, entries.map((e) => e.id)));
      await db.delete(capitalChanges).where(eq(capitalChanges.tenantId, tenant.id));
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    },
  };
}
