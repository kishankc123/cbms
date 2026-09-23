import type { Condition } from "../engine/applicability";
import type { DueRule } from "../engine/due-rules";

export type TemplateSeed = {
  key: string;
  name: string;
  description?: string;
  categoryKey: string;
  taxTypeKey?: string;
  authorityKey?: string;
  /** null = every entity type in the country. */
  entityTypeKey?: string | null;
  frequency: "monthly" | "quarterly" | "annual" | "one_time" | "event_based";
  periodCalendar?: "statutory" | "org" | "AD" | "BS";
  applicability?: Condition | null;
  /** null for event-based requirements (nothing to schedule until the event happens). */
  dueRule?: DueRule | null;
  isActive: boolean;
  /** A reviewer has confirmed the rule against current law. New seed data starts unverified. */
  isVerified: boolean;
};

export type PenaltyRuleSeed = {
  taxTypeKey: string;
  effectiveFrom: string;
  /** The shape matches one of VatPenaltyParams / TdsPenaltyParams / ExcisePenaltyParams in lib/compliance/penalty-engine — kept as a plain object here so config doesn't depend on that module. */
  params: Record<string, number>;
  /** A reviewer has confirmed these figures against current law. New seed data starts unverified. */
  isVerified: boolean;
};

/** Everything that defines one country. Adding a country = adding one of these. */
export type CountryConfig = {
  country: { code: string; name: string; currency: string; statutoryCalendar: "AD" | "BS" };
  entityTypes: { key: string; name: string }[];
  authorities: { key: string; name: string }[];
  taxTypes: { key: string; name: string; authorityKey?: string; isRegistrable?: boolean; numberSource?: "company_pan_vat"; amountSource?: "vat_return" | "tds_withheld"; payableAccountName?: string; legacyPayableCode?: string }[];
  templates: TemplateSeed[];
  /** Late-filing/payment penalty formula parameters, versioned by effective date. Optional: a country can ship without these and add them later. */
  penaltyRules?: PenaltyRuleSeed[];
};

// Categories are shared by every country.
export const COMPLIANCE_CATEGORIES = [
  { key: "tax", name: "Tax" },
  { key: "statutory", name: "Statutory" },
  { key: "ownership", name: "Ownership" },
  { key: "company", name: "Company" },
] as const;
