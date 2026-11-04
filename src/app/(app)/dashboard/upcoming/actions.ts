"use server";

import { requireTenantSession, can } from "@/lib/session";
import { todayIso } from "@/lib/calendar";
import { isBucket, upcomingDocuments, type DueBucket, type UpcomingItem } from "@/lib/dashboard/upcoming";

/** The documents behind one row of the Upcoming tab, loaded when the row is opened so the page itself stays light. */
export async function loadPartyDocuments(input: { side: "coming" | "going"; key: string; bucket: DueBucket | null }): Promise<{ items: UpcomingItem[]; hasMore: boolean }> {
  const session = await requireTenantSession();
  if (!can(session, "chart_of_accounts", "view")) throw new Error("Not permitted");
  if ((input.side !== "coming" && input.side !== "going") || typeof input.key !== "string" || input.key.length > 200 || (input.bucket !== null && !isBucket(input.bucket))) throw new Error("That request is not valid.");
  return upcomingDocuments(session.tenantId, todayIso(), input.side, input.key, input.bucket);
}
