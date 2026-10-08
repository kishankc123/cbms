import type { IsoDate } from "@/lib/calendar";
import type { complianceRequirementTemplates } from "@/db/schema";

type Template = typeof complianceRequirementTemplates.$inferSelect;

/** Is the template usable for this organization on this date (entity type, active window, has something to schedule)? */
export function templateInScope(t: Template, entityType: string | null, today: IsoDate): boolean {
  if (!t.isActive || t.frequency === "event_based" || !t.dueRule) return false;
  if (t.entityTypeKey && t.entityTypeKey !== entityType) return false;
  if (t.activeFrom && t.activeFrom > today) return false;
  if (t.activeTo && t.activeTo < today) return false;
  return true;
}
