import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformPayrollRuleVersions, platformTaxDepreciationRuleVersions } from "@/db/schema";
import { NEPAL_DEFAULT_RULES } from "@/lib/payroll/retirement-rules";
import { NEPAL_TAX_DEPRECIATION_RULES } from "@/lib/tax-depreciation/rules";

// The starting versions of the platform rule sets a country ships with (payroll rules, tax depreciation rules). They are loaded as UNVERIFIED and only
// when the country has no version of that rule set at all, so a platform administrator's own versions and edits are never touched or re-added.

type Executor = Pick<typeof db, "select" | "insert">;

export async function seedPlatformRules(countryCode: string, run: Executor = db): Promise<{ payroll: boolean; taxDepreciation: boolean }> {
  const done = { payroll: false, taxDepreciation: false };
  if (countryCode !== "NP") return done;

  const [payroll] = await run.select({ id: platformPayrollRuleVersions.id }).from(platformPayrollRuleVersions).where(eq(platformPayrollRuleVersions.countryCode, countryCode)).limit(1);
  if (!payroll) {
    await run.insert(platformPayrollRuleVersions).values({
      countryCode, effectiveFrom: "2026-07-17", rules: NEPAL_DEFAULT_RULES, isVerified: false,
      source: "Initial values from the payroll specification for FY 2083/84. Not yet checked against the Finance Act, Income Tax Act or SSF rules.",
    }).onConflictDoNothing();
    done.payroll = true;
  }

  const [depreciation] = await run.select({ id: platformTaxDepreciationRuleVersions.id }).from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, countryCode)).limit(1);
  if (!depreciation) {
    await run.insert(platformTaxDepreciationRuleVersions).values({
      countryCode, effectiveFrom: "2018-07-17", rules: NEPAL_TAX_DEPRECIATION_RULES, isVerified: false,
      source: "Income Tax Act 2058, Schedule 2 (loaded as unverified; confirm against the current Finance Act)",
    }).onConflictDoNothing();
    done.taxDepreciation = true;
  }
  return done;
}
