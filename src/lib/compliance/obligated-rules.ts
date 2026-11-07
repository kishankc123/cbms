import { isApplicable, type Facts } from "./engine/applicability";
import { templateInScope } from "./engine/scope";
import type { complianceRequirementTemplates } from "@/db/schema";

type Template = typeof complianceRequirementTemplates.$inferSelect;

// Which compliance items an organization is still obliged to: only what the platform administrator has published for the country AND the organization
// has chosen or the rules say applies to it. The generator never deletes an item, so one can outlive the thing that created it (a template switched off,
// a registration that is no longer active); the dashboard hides those. They stay in the Compliance calendar, which is the full record.

export type ObligationRef = { id: string; templateId: string | null; source: string; taxTypeKey: string | null; status: string };

export type ObligatedContext = {
  entityType: string | null;
  today: string;
  facts: Facts;
  /** The country is switched on for compliance. */
  countryActive: boolean;
  templates: Map<string, Template>;
  /** Tax types the platform has published for the country: key to whether it is switched on. */
  taxTypes: Map<string, boolean>;
  /** Tax types an organization can register for. */
  registrable: Set<string>;
  /** Tax types the organization holds an ACTIVE registration for. */
  activeRegistrations: Set<string>;
};

const isDone = (status: string) => status === "filed" || status === "paid" || status === "not_applicable";

/** Items that are done are history and always count. An open item counts only while what created it still applies. */
export function isStillObligated(row: ObligationRef, ctx: ObligatedContext): boolean {
  if (isDone(row.status)) return true;
  if (row.source === "manual") return true; // entered by a person: theirs to keep or close
  if (!ctx.countryActive) return false;
  if (row.taxTypeKey && ctx.taxTypes.get(row.taxTypeKey) === false) return false; // the tax was unpublished by the platform

  if (row.templateId) {
    const t = ctx.templates.get(row.templateId);
    if (!t) return false;
    if (row.taxTypeKey === null && t.taxTypeKey && ctx.taxTypes.get(t.taxTypeKey) === false) return false;
    // An event-based requirement is raised by its event, so it has no schedule to be "in scope" for; it counts while it is switched on.
    const live = t.frequency === "event_based" ? t.isActive : templateInScope(t, ctx.entityType, ctx.today);
    if (!live) return false;
    try {
      return isApplicable(t.applicability, ctx.facts);
    } catch {
      return true; // a condition that can't be read is a platform data problem: never hide an obligation because of it
    }
  }

  // No template (the excise permit renewals, items carried over from the old calendar): a taxed item counts while the organization holds that registration.
  if (row.taxTypeKey && ctx.registrable.has(row.taxTypeKey)) return ctx.activeRegistrations.has(row.taxTypeKey);
  return true;
}

export function filterObligated<T extends ObligationRef>(rows: T[], ctx: ObligatedContext): T[] {
  return rows.filter((r) => isStillObligated(r, ctx));
}
