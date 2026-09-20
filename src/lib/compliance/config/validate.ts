import { assertValidCondition } from "../engine/applicability";
import { assertValidDueRule } from "../engine/due-rules";
import { COMPLIANCE_CATEGORIES, type CountryConfig } from "./types";

/** Throws if a country's templates are malformed. Pure — run before anything is written. */
export function validateCountryConfig(config: CountryConfig) {
  const keys = new Set<string>();
  const categories = new Set<string>(COMPLIANCE_CATEGORIES.map((c) => c.key));
  const taxTypes = new Set(config.taxTypes.map((t) => t.key));
  const entityTypes = new Set(config.entityTypes.map((e) => e.key));
  const authorities = new Set(config.authorities.map((a) => a.key));
  for (const t of config.templates) {
    const where = `${config.country.code}/${t.key}`;
    if (keys.has(t.key)) throw new Error(`${where}: duplicate template key`);
    keys.add(t.key);
    if (!categories.has(t.categoryKey)) throw new Error(`${where}: unknown category "${t.categoryKey}"`);
    if (t.taxTypeKey && !taxTypes.has(t.taxTypeKey)) throw new Error(`${where}: unknown tax type "${t.taxTypeKey}"`);
    if (t.authorityKey && !authorities.has(t.authorityKey)) throw new Error(`${where}: unknown authority "${t.authorityKey}"`);
    if (t.entityTypeKey && !entityTypes.has(t.entityTypeKey)) throw new Error(`${where}: unknown entity type "${t.entityTypeKey}"`);
    if (t.applicability) assertValidCondition(t.applicability, `${where} applicability`);
    if (t.dueRule) assertValidDueRule(t.dueRule);
    if (t.frequency !== "event_based" && t.isActive && !t.dueRule) throw new Error(`${where}: an active scheduled requirement needs a due rule`);
  }
  for (const tt of config.taxTypes) {
    if (tt.authorityKey && !authorities.has(tt.authorityKey)) throw new Error(`${config.country.code}/${tt.key}: unknown authority "${tt.authorityKey}"`);
  }
}
