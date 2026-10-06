import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollSettings } from "@/db/schema";

// Not a server action on purpose: it takes a tenantId, so it must only be called from server code that already knows the
// signed-in organization, never directly from the browser.
export async function getOrCreateSettings(tenantId: string) {
  const [existing] = await db.select().from(payrollSettings).where(eq(payrollSettings.tenantId, tenantId)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(payrollSettings).values({ tenantId }).returning();
  return created;
}
