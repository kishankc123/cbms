import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceCountries, platformPayrollRuleVersions, platformTaxDepreciationRuleVersions } from "@/db/schema";
import { NEPAL_TAX_DEPRECIATION_RULES } from "@/lib/tax-depreciation/rules";
import { seedPlatformRules } from "./platform-rule-seeds";

// Each case runs inside a transaction that is rolled back, so the shared development data is never changed.
const rollback = new Error("rollback");
async function inRolledBackTransaction(work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
}

describe("the starting platform rules for a country", () => {
  it("loads both Nepal rule sets, unverified, when Nepal has none, and leaves them alone the second time", async () => {
    await inRolledBackTransaction(async (tx) => {
      // a fresh database has the country but no rule versions
      await tx.insert(complianceCountries).values({ code: "NP", name: "Nepal", currency: "NPR", statutoryCalendar: "BS", fiscalYearStartMonth: 4 }).onConflictDoNothing();
      await tx.delete(platformPayrollRuleVersions).where(eq(platformPayrollRuleVersions.countryCode, "NP"));
      await tx.delete(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, "NP"));

      expect(await seedPlatformRules("NP", tx)).toEqual({ payroll: true, taxDepreciation: true });
      const [pay] = await tx.select().from(platformPayrollRuleVersions).where(eq(platformPayrollRuleVersions.countryCode, "NP"));
      const [dep] = await tx.select().from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, "NP"));
      expect(pay).toMatchObject({ isVerified: false, effectiveTo: null });
      expect(dep).toMatchObject({ isVerified: false, effectiveTo: null });
      expect((dep.rules as typeof NEPAL_TAX_DEPRECIATION_RULES).pools.map((p) => p.key)).toEqual(["A", "B", "C", "D", "E"]);

      // running it again adds nothing
      expect(await seedPlatformRules("NP", tx)).toEqual({ payroll: false, taxDepreciation: false });
      expect(await tx.select().from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, "NP"))).toHaveLength(1);
    });
  });

  it("does not add a version when the administrator already has one, and does nothing for other countries", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.insert(complianceCountries).values({ code: "NP", name: "Nepal", currency: "NPR", statutoryCalendar: "BS", fiscalYearStartMonth: 4 }).onConflictDoNothing();
      await tx.delete(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, "NP"));
      await tx.insert(platformTaxDepreciationRuleVersions).values({ countryCode: "NP", effectiveFrom: "2030-01-01", rules: NEPAL_TAX_DEPRECIATION_RULES, isVerified: true, source: "Finance Act 2087" });
      expect((await seedPlatformRules("NP", tx)).taxDepreciation).toBe(false);
      const rows = await tx.select().from(platformTaxDepreciationRuleVersions).where(eq(platformTaxDepreciationRuleVersions.countryCode, "NP"));
      expect(rows).toHaveLength(1);
      expect(rows[0].isVerified).toBe(true);
    });
    expect(await seedPlatformRules("ZZ")).toEqual({ payroll: false, taxDepreciation: false });
  });
});
