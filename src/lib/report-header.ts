import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tenants } from "@/db/schema";

/** The company name and address printed at the top of a report. */
export async function loadReportHeader(tenantId: string) {
  const [t] = await db.select({ company: tenants.companyName, address: tenants.address }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return { company: t?.company ?? "", address: t?.address ?? "" };
}
