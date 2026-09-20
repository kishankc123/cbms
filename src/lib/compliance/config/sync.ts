import { db } from "@/db";
import {
  complianceAuthorities,
  complianceCategories,
  complianceCountries,
  complianceEntityTypes,
  complianceRequirementTemplates,
  complianceTaxTypes,
} from "@/db/schema";
import { COMPLIANCE_CATEGORIES, type CountryConfig } from "./types";
import { COUNTRY_CONFIGS } from "./index";
import { validateCountryConfig } from "./validate";

/**
 * Loads the shipped country configuration into the database. Insert-only: a row
 * that already exists is left exactly as it is, so anything a platform admin has
 * edited (activated a template, changed a rule) survives every re-run.
 */
export async function syncComplianceConfig(configs: CountryConfig[] = COUNTRY_CONFIGS) {
  configs.forEach(validateCountryConfig);

  await db
    .insert(complianceCategories)
    .values(COMPLIANCE_CATEGORIES.map((c, i) => ({ key: c.key, name: c.name, sortOrder: i })))
    .onConflictDoNothing();

  for (const c of configs) {
    const countryCode = c.country.code;
    await db.insert(complianceCountries).values(c.country).onConflictDoNothing();
    await db
      .insert(complianceEntityTypes)
      .values(c.entityTypes.map((e, i) => ({ countryCode, key: e.key, name: e.name, sortOrder: i })))
      .onConflictDoNothing();
    await db
      .insert(complianceAuthorities)
      .values(c.authorities.map((a) => ({ countryCode, ...a })))
      .onConflictDoNothing();
    await db
      .insert(complianceTaxTypes)
      .values(
        c.taxTypes.map((t, i) => ({
          countryCode,
          key: t.key,
          name: t.name,
          authorityKey: t.authorityKey,
          isRegistrable: t.isRegistrable ?? false,
          numberSource: t.numberSource,
          amountSource: t.amountSource,
          payableAccountName: t.payableAccountName,
          legacyPayableCode: t.legacyPayableCode,
          sortOrder: i,
        }))
      )
      .onConflictDoNothing();
    await db
      .insert(complianceRequirementTemplates)
      .values(
        c.templates.map((t) => ({
          countryCode,
          entityTypeKey: t.entityTypeKey ?? null,
          categoryKey: t.categoryKey,
          taxTypeKey: t.taxTypeKey ?? null,
          authorityKey: t.authorityKey ?? null,
          key: t.key,
          name: t.name,
          description: t.description ?? null,
          frequency: t.frequency,
          periodCalendar: t.periodCalendar ?? "statutory",
          applicability: t.applicability ?? null,
          dueRule: t.dueRule ?? null,
          isActive: t.isActive,
          isVerified: t.isVerified,
        }))
      )
      .onConflictDoNothing();
  }
}
